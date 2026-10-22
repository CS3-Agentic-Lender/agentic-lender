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
        var request = request(Self.path, idToken: idToken)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try profile.body()

        let (_, status) = try await perform(request)
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
        let (_, status) = try await perform(request(Self.path, idToken: idToken))
        switch status {
        case 200: return true
        case 404: return false
        default:
            logger.error("GET /core/me returned \(status, privacy: .public)")
            throw AccountError.unknown
        }
    }

    /// The signed-in borrower's profile: their name for the greeting and their broker, if chosen.
    func profile(idToken: String) async throws -> CoreProfile {
        let (data, status) = try await perform(request(Self.path, idToken: idToken))
        if status == 404 { throw AccountError.noProfile }
        return try decode(CoreProfile.self, from: data, status: status, call: "GET /core/me")
    }

    /// Builds an authorised request to `path` under the gateway; a GET unless changed.
    func request(_ path: String, idToken: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        return request
    }

    /// Sends the request; a dropped connection becomes `AccountError.network`.
    func perform(_ request: URLRequest) async throws -> (Data, Int) {
        let call = "\(request.httpMethod ?? "GET") \(request.url?.path() ?? "")"
        do {
            let (data, response) = try await send(request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let error as URLError {
            logger.error("\(call, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError.network
        }
    }

    /// Decodes a 200 answer; any other status, or a body that doesn't match, is `AccountError.unknown`.
    func decode<Value: Decodable>(_ type: Value.Type, from data: Data, status: Int, call: String) throws -> Value {
        guard status == 200 else {
            logger.error("\(call, privacy: .public) returned \(status, privacy: .public)")
            throw AccountError.unknown
        }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            logger.error("\(call, privacy: .public) sent an answer the app can't read: \(error.localizedDescription, privacy: .public)")
            throw AccountError.unknown
        }
    }
}

/// The part of the `GET /core/me` profile the app reads. al-core sends `broker_name` and
/// `broker_firm` (AL-56) so the app never reads a broker's own profile.
struct CoreProfile: Decodable, Equatable, Sendable {
    let fullName: String
    let brokerID: String?
    let brokerName: String?
    let brokerFirm: String?

    /// Whether the borrower still has to choose a broker before home.
    var needsBroker: Bool {
        brokerName?.trimmed.isEmpty ?? true
    }

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case brokerID = "broker_id"
        case brokerName = "broker_name"
        case brokerFirm = "broker_firm"
    }
}
