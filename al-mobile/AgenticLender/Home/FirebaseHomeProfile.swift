import FirebaseAuth
import Foundation
import os

/// Reads the signed-in borrower's name for home: the Firebase ID token, then `GET /core/me`.
enum FirebaseHomeProfile {
    private static let logger = Logger(category: "Home")

    static func loadFullName(
        profileAPI: CoreProfileAPI = CoreProfileAPI(
            baseURL: BackendConfig().apiBaseURL,
            send: { try await URLSession.shared.data(for: $0) }
        )
    ) async throws -> String {
        guard let user = Auth.auth().currentUser else {
            logger.error("Home opened with no signed-in Firebase user")
            throw AccountError.unknown
        }
        let idToken: String
        do {
            idToken = try await user.getIDToken()
        } catch {
            logger.error("Getting the ID token for home failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError(authError: error)
        }
        return try await profileAPI.fullName(idToken: idToken)
    }
}
