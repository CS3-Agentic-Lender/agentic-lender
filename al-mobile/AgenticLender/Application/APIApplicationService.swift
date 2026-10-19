import Foundation
import os

/// Calls `POST /core/applications` through the API gateway with the borrower's Firebase ID token.
struct APIApplicationService: ApplicationService {
    static let path = "core/applications"

    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token; throws `ApplicationSaveError.signedOut` when there is none.
    let idToken: @Sendable () async throws -> String

    private let logger = Logger(category: "Application")

    func saveDraft(_ draft: ApplicationDraft) async throws -> DraftSaveOutcome {
        let token = try await idToken()
        var request = URLRequest(url: baseURL.appending(path: Self.path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try draft.body()

        let (data, response) = try await send(request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 201, 200:
            let id = try savedID(from: data)
            return status == 201 ? .created(id: id) : .existingDraft(id: id)
        case 401:
            throw ApplicationSaveError.signedOut
        case 409:
            throw Self.conflictError(from: data)
        case 422:
            throw Self.invalidFieldError(from: data)
        default:
            logger.error("POST /core/applications returned \(status, privacy: .public)")
            throw ApplicationSaveError.unavailable
        }
    }

    private func savedID(from data: Data) throws -> String {
        do {
            return try JSONDecoder().decode(SavedApplication.self, from: data).id
        } catch {
            logger.error("POST /core/applications sent an answer the app can't read: \(error.localizedDescription, privacy: .public)")
            throw ApplicationSaveError.unavailable
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            logger.error("POST /core/applications failed: \(error.localizedDescription, privacy: .public)")
            throw ApplicationSaveError.network
        }
    }

    /// al-core refuses a new Draft with 409 for three reasons, told apart by its message
    /// (al-core `app/applications.py`). Anything else is shown as al-core wrote it.
    static func conflictError(from data: Data) -> ApplicationSaveError {
        guard let message = ErrorEnvelope.message(in: data) else { return .unavailable }
        if message.hasPrefix("Create your profile first") { return .noProfile }
        if message.hasPrefix("Choose a broker") { return .noBroker }
        if message.contains("already have an application in progress") { return .inProgress }
        return .rejected(message)
    }

    /// A 422 names the API field it rejected, as a path for the property (`property.eircode`).
    static func invalidFieldError(from data: Data) -> ApplicationSaveError {
        guard let detail = ErrorEnvelope.decode(data) else { return .unavailable }
        if let field = detail.field, let name = fieldNames[field] { return .invalidField(name) }
        return ErrorEnvelope.message(in: data).map(ApplicationSaveError.rejected) ?? .unavailable
    }

    /// API field → how the application form labels it.
    private static let fieldNames = [
        "applicants": "single or joint choice",
        "gross_income_eur": "income",
        "monthly_debts_eur": "monthly debts",
        "deposit_eur": "deposit",
        "first_time_buyer": "first-time buyer choice",
        "term_years": "term",
        "loan_amount_eur": "loan amount",
        "employment_type": "employment",
        "years_in_current_job": "years in current job",
        "monthly_take_home_eur": "monthly take-home pay",
        "monthly_living_costs_eur": "monthly living costs",
        "property.address_line_1": "first line of the address",
        "property.address_line_2": "second line of the address",
        "property.eircode": "Eircode",
        "property.county": "county",
        "property.asking_price_eur": "asking price",
        "property.property_type": "property type",
        "property.bedrooms": "number of bedrooms",
        "property.floor_area_sqm": "floor area",
        "property.ber_rating": "BER rating",
    ]

    /// The one field of the saved application the form needs.
    private struct SavedApplication: Decodable {
        let id: String
    }
}

/// The error body every al-core response uses: `{"error": {"code", "message", "field", "request_id"}}`.
struct ErrorEnvelope: Decodable {
    struct Detail: Decodable {
        let message: String?
        let field: String?
    }

    let error: Detail

    static func decode(_ data: Data) -> Detail? {
        try? JSONDecoder().decode(ErrorEnvelope.self, from: data).error
    }

    static func message(in data: Data) -> String? {
        decode(data)?.message.flatMap { $0.isBlank ? nil : $0 }
    }
}
