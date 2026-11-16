import FirebaseAuth

/// Firebase Auth's saved login, kept in the keychain between launches.
struct FirebaseSignedInState: SignedInState {
    var hasSignedInUser: Bool { Auth.auth().currentUser != nil }

    func signOut() throws {
        try Auth.auth().signOut()
    }

    /// Firebase reports the current user at once and on every change; only a user becoming nil counts.
    func onSignedOut(_ handler: @escaping @MainActor () -> Void) {
        let lastUser = LastUser(uid: Auth.auth().currentUser?.uid)
        _ = Auth.auth().addStateDidChangeListener { _, user in
            defer { lastUser.uid = user?.uid }
            guard user == nil, lastUser.uid != nil else { return }
            Task { @MainActor in handler() }
        }
    }
}

/// Who was signed in when Firebase last reported, so a sign-out is told apart from "nobody yet".
private final class LastUser: @unchecked Sendable {
    var uid: String?

    init(uid: String?) {
        self.uid = uid
    }
}

extension SessionCheck {
    /// A refused token forces a refresh. If the account was deleted or disabled the refresh fails and
    /// Firebase signs the borrower out itself, which `AppSession` reports as an ended session (AL-315).
    /// Firebase doesn't always sign out by itself when the refresh fails (the emulator answers
    /// INVALID_REFRESH_TOKEN and the user stays signed in), so the app does, which `AppSession` then reports.
    static func useFirebase() {
        tokenRefused = {
            guard let user = Auth.auth().currentUser else { return }
            do {
                _ = try await user.getIDTokenResult(forcingRefresh: true)
            } catch where accountIsGone(error) {
                try? Auth.auth().signOut()
            } catch {
                // A network failure: the screen keeps its own Retry.
            }
        }
    }

    /// The refresh failed because the account was deleted or disabled, not because of the network.
    nonisolated static func accountIsGone(_ error: Error) -> Bool {
        let nsError = error as NSError
        guard nsError.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: nsError.code) else { return false }
        return [.userNotFound, .userDisabled, .userTokenExpired, .invalidUserToken].contains(code)
    }
}
