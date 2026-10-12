import Foundation
import os

/// Calls `POST /core/me` through the API gateway with the new user's Firebase ID token.
///
/// Agreed with Dumi on AL-220: 201 creates the profile, a repeat call returns 200 and changes
/// nothing, and refused input comes back as 422. Both 201 and 200 mean the profile is saved.
struct CoreProfileAPI: Sendable {
    static let path = "core/me"

    let baseURL: URL
    /// Sends a request and returns the response; `URLSession.shared.data(for:)` in the app.
    let send: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    private let logger = Logger(category: "SignUp")

    func createProfile(_ profile: BorrowerProfile, idToken: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: Self.path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try profile.body()

        let response: URLResponse
        do {
            (_, response) = try await send(request)
        } catch let error as URLError {
            logger.error("POST /core/me failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError.network
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 201 || status == 200 else {
            logger.error("POST /core/me returned \(status, privacy: .public)")
            throw AccountError.profileNotSaved
        }
    }
}
