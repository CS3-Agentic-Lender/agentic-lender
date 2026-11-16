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
    static func useFirebase() {
        tokenRefused = {
            _ = try? await Auth.auth().currentUser?.getIDTokenResult(forcingRefresh: true)
        }
    }
}
