import FirebaseAuth
import Foundation
import os

/// A Stripe payment intent for the fee, created by al-core (AL-72). The app only gets the client
/// secret to hand to Stripe's payment sheet; the secret key stays on the server.
struct FeeIntent: Equatable, Sendable {
    let clientSecret: String
    let paymentIntentID: String
    let amountEur: Int
}

@MainActor
protocol FeeService {
    func createIntent(applicationID: String) async throws -> FeeIntent
}

/// `POST /core/applications/{id}/fee-intent` through the API gateway. al-core returns the same intent
/// if it's called again, so Try again never creates a second charge.
struct APIFeeService: FeeService {
    let baseURL: URL
    let session: URLSession
    let idToken: @Sendable () async throws -> String

    func createIntent(applicationID: String) async throws -> FeeIntent {
        let gateway = APIGateway(baseURL: baseURL, session: session, idToken: idToken, logger: Logger(category: "Fee"))
        return try await gateway.post("core/applications/\(applicationID)/fee-intent", body: Data("{}".utf8), decode: Self.decode)
    }

    static func decode(_ data: Data) throws -> FeeIntent {
        struct Answer: Decodable {
            let client_secret: String
            let payment_intent_id: String
            let amount_eur: Int
        }
        let answer = try JSONDecoder().decode(Answer.self, from: data)
        return FeeIntent(clientSecret: answer.client_secret, paymentIntentID: answer.payment_intent_id, amountEur: answer.amount_eur)
    }

    /// The service the app uses: the configured gateway, signed with the current Firebase user's ID token.
    static func live(backend: BackendConfig = BackendConfig()) -> APIFeeService {
        APIFeeService(baseURL: backend.apiBaseURL, session: .shared) {
            guard let user = Auth.auth().currentUser else { throw APIError.signedOut }
            do {
                return try await user.getIDToken()
            } catch {
                throw AuthErrorCode(rawValue: (error as NSError).code) == .networkError ? APIError.network : APIError.signedOut
            }
        }
    }
}
