import Foundation
import os

/// Calls `/core/me` through the API gateway with the user's Firebase ID token.
///
/// Agreed with Dumi on AL-220: `POST` returns 201 when it creates the profile, a repeat call
/// returns 200 and changes nothing, and refused input comes back as 422. Both 201 and 200 mean
/// the profile is saved. `GET` returns the profile, or 404 if there is none yet.
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
            throw Self.serverErrors.contains(status) ? ServerError(status: status) : AccountError.profileNotSaved
        }
    }

    /// A 5xx from `POST /core/me`: the server failed rather than refused, so sign-up tries again (AL-239).
    struct ServerError: Error, Equatable {
        let status: Int
    }

    private static let serverErrors = 500...599

    /// Whether the signed-in user already has a profile: 200 yes, 404 not yet.
    func hasProfile(idToken: String) async throws -> Bool {
        var request = URLRequest(url: baseURL.appending(path: Self.path))
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let response: URLResponse
        do {
            (_, response) = try await send(request)
        } catch let error as URLError {
            logger.error("GET /core/me failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError.network
        }

        switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
        case 200: return true
        case 404: return false
        case let status:
            logger.error("GET /core/me returned \(status, privacy: .public)")
            throw AccountError.unknown
        }
    }

    /// The signed-in borrower's full name from their profile, for the home screen greeting.
    func fullName(idToken: String) async throws -> String {
        var request = URLRequest(url: baseURL.appending(path: Self.path))
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await send(request)
        } catch let error as URLError {
            logger.error("GET /core/me failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError.network
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            logger.error("GET /core/me returned \(status, privacy: .public)")
            throw AccountError.unknown
        }
        do {
            return try JSONDecoder().decode(StoredName.self, from: data).fullName
        } catch {
            logger.error("GET /core/me sent a profile without a full name: \(error.localizedDescription, privacy: .public)")
            throw AccountError.unknown
        }
    }

    /// The one field of the `GET /core/me` profile the app reads so far.
    private struct StoredName: Decodable {
        let fullName: String

        enum CodingKeys: String, CodingKey {
            case fullName = "full_name"
        }
    }
}
