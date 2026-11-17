import FirebaseAuth
import Foundation
import os

/// What al-core gives back for a saved request: its reference and when it was sent (Figma 21).
struct SupportReceipt: Equatable, Sendable {
    let reference: String
    let sentAt: Date
}

/// Sends a support request to al-core.
@MainActor
protocol SupportService {
    func send(_ body: Data) async throws -> SupportReceipt
}

/// `POST /core/support-requests` through the API gateway with the borrower's ID token (AL-149).
/// al-core answers `201` with `reference` and `created_at`; failures are `APIError`s.
struct APISupportService: SupportService {
    static let path = "core/support-requests"

    let baseURL: URL
    let session: URLSession
    let idToken: @Sendable () async throws -> String

    func send(_ body: Data) async throws -> SupportReceipt {
        let gateway = APIGateway(baseURL: baseURL, session: session, idToken: idToken, logger: Logger(category: "Support"))
        return try await gateway.post(Self.path, body: body, decode: Self.decode)
    }

    static func decode(_ data: Data) throws -> SupportReceipt {
        struct Answer: Decodable {
            let reference: String
            let created_at: String
        }
        let answer = try JSONDecoder().decode(Answer.self, from: data)
        guard let sentAt = ISO8601Timestamp.date(from: answer.created_at) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "created_at isn't ISO 8601"))
        }
        return SupportReceipt(reference: answer.reference, sentAt: sentAt)
    }

    /// The service the app uses: the configured gateway, signed with the current Firebase user's ID token.
    static func live(backend: BackendConfig = BackendConfig()) -> APISupportService {
        APISupportService(baseURL: backend.apiBaseURL, session: .shared) {
            guard let user = Auth.auth().currentUser else { throw APIError.signedOut }
            do {
                return try await user.getIDToken()
            } catch {
                throw AuthErrorCode(rawValue: (error as NSError).code) == .networkError ? APIError.network : APIError.signedOut
            }
        }
    }
}

/// al-core's timestamps, with or without fractional seconds.
enum ISO8601Timestamp {
    static func date(from text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
