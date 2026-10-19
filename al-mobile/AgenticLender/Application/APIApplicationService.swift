import Foundation
import os

/// Calls al-core's applications endpoints through the API gateway with the borrower's Firebase ID token:
/// `POST /core/applications`, and `PATCH` and `GET /core/applications/{id}`.
struct APIApplicationService: ApplicationService {
    static let path = "core/applications"

    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token; throws `ApplicationSaveError.signedOut` when there is none.
    let idToken: @Sendable () async throws -> String

    private let logger = Logger(category: "Application")

    func saveDraft(_ draft: ApplicationDraft) async throws -> DraftSaveOutcome {
        let (data, status) = try await send("POST", Self.path, body: draft.body())
        switch status {
        case 201: return .created(id: try decode(SavedID.self, from: data, "POST").id)
        case 200: return .existingDraft(id: try decode(SavedID.self, from: data, "POST").id)
        default: throw failure(status, data, "POST")
        }
    }

    func editDraft(id: String, _ draft: ApplicationDraft) async throws {
        let (data, status) = try await send("PATCH", "\(Self.path)/\(id)", body: draft.body())
        guard status == 200 else { throw failure(status, data, "PATCH") }
    }

    func loadApplication(id: String) async throws -> StoredApplication {
        let (data, status) = try await send("GET", "\(Self.path)/\(id)", body: nil)
        guard status == 200 else { throw failure(status, data, "GET") }
        return try decode(StoredApplication.self, from: data, "GET")
    }

    private func send(_ method: String, _ path: String, body: Data?) async throws -> (Data, Int) {
        let token = try await idToken()
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let error as URLError {
            logger.error("\(method, privacy: .public) /core/applications failed: \(error.localizedDescription, privacy: .public)")
            throw ApplicationSaveError.network
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data, _ method: String) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            logger.error("\(method, privacy: .public) /core/applications sent an answer the app can't read: \(error.localizedDescription, privacy: .public)")
            throw ApplicationSaveError.unavailable
        }
    }

    /// The error for a status that isn't a success.
    private func failure(_ status: Int, _ data: Data, _ method: String) -> ApplicationSaveError {
        switch status {
        case 401: return .signedOut
        case 404: return .draftNotFound
        case 409: return Self.conflictError(from: data)
        case 422: return Self.invalidFieldError(from: data)
        default:
            logger.error("\(method, privacy: .public) /core/applications returned \(status, privacy: .public)")
            return .unavailable
        }
    }

    /// al-core refuses with 409 for four reasons, told apart by its message
    /// (al-core `app/applications.py`). Anything else is shown as al-core wrote it.
    static func conflictError(from data: Data) -> ApplicationSaveError {
        guard let message = ErrorEnvelope.message(in: data) else { return .unavailable }
        if message.hasPrefix("Create your profile first") { return .noProfile }
        if message.hasPrefix("Choose a broker") { return .noBroker }
        if message.contains("already have an application in progress") { return .inProgress }
        if message.hasPrefix("Only a Draft can be edited") { return .submitted }
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

    /// The one field of a newly saved application the form needs.
    private struct SavedID: Decodable {
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
