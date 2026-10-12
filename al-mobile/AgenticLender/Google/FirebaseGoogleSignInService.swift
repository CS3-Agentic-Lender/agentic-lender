import FirebaseAuth
import Foundation
import os

/// Signs in to Firebase Auth with a Google token, then asks al-core whether a profile exists.
///
/// "Returning" means the profile exists, not that Firebase has seen the Google account before:
/// someone who left before filling in the profile has to finish it before reaching home.
struct FirebaseGoogleSignInService: GoogleSignInService {
    let profileAPI: CoreProfileAPI

    private let logger = Logger(category: "GoogleSignIn")

    init(profileAPI: CoreProfileAPI = CoreProfileAPI(
        baseURL: BackendConfig().apiBaseURL,
        send: { try await URLSession.shared.data(for: $0) }
    )) {
        self.profileAPI = profileAPI
    }

    func signIn(with token: GoogleToken) async throws -> GoogleSignInOutcome {
        let user: User
        do {
            let credential = GoogleAuthProvider.credential(withIDToken: token.idToken, accessToken: token.accessToken)
            user = try await Auth.auth().signIn(with: credential).user
        } catch {
            logger.error("Firebase Google sign-in failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError(authError: error)
        }

        do {
            guard try await profileAPI.hasProfile(idToken: user.getIDToken()) else {
                return .needsProfile(GoogleUser(email: user.email ?? "", name: user.displayName ?? ""))
            }
            return .signedIn
        } catch {
            // Without the profile check the app can't tell home from the profile screen, so start again.
            signOut()
            throw error as? AccountError ?? AccountError.unknown
        }
    }

    func completeProfile(_ profile: BorrowerProfile) async throws {
        guard let user = Auth.auth().currentUser else {
            logger.error("Saving a Google profile with no signed-in user")
            throw AccountError.unknown
        }
        // Unlike email sign-up, a failure keeps the login: it is the borrower's Google account,
        // and they can try again or sign in later to finish the profile.
        try await profileAPI.createProfile(profile, idToken: user.getIDToken())

        // The token from before POST /core/me has no role yet (api-design.md, section 4).
        do {
            _ = try await user.getIDTokenResult(forcingRefresh: true)
        } catch {
            logger.error("Refreshing the ID token after the Google profile failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func signOut() {
        do {
            try Auth.auth().signOut()
        } catch {
            logger.error("Signing out after a failed profile check failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
