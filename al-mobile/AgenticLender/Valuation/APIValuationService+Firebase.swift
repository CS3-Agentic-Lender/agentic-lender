import FirebaseAuth
import Foundation

extension APIValuationService {
    /// The service the app uses: the local gateway, signed with the current Firebase user's ID token.
    static func live(backend: BackendConfig = BackendConfig()) -> APIValuationService {
        APIValuationService(baseURL: backend.apiBaseURL, session: .shared, idToken: currentIDToken)
    }

    @Sendable
    private static func currentIDToken() async throws -> String {
        guard let user = Auth.auth().currentUser else { throw APIError.signedOut }
        do {
            return try await user.getIDToken()
        } catch {
            let code = AuthErrorCode(rawValue: (error as NSError).code)
            throw code == .networkError ? APIError.network : APIError.signedOut
        }
    }
}
