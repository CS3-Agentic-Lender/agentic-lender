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
            throw ApplicationSaveError.inProgress
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

    /// The one field of the saved application the form needs.
    private struct SavedApplication: Decodable {
        let id: String
    }
}
