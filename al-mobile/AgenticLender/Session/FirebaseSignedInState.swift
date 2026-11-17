import FirebaseAuth
import os

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
                Logger(category: "Session").info("Token refresh after a 401 succeeded")
            } catch {
                let nsError = error as NSError
                Logger(category: "Session").error("Token refresh after a 401 failed: \(nsError.domain, privacy: .public) \(nsError.code, privacy: .public)")
                // A network failure keeps the screen's own Retry.
                if accountIsGone(error) { try? Auth.auth().signOut() }
            }
        }
    }

    /// The refresh failed because the account was deleted or disabled, not because of the network.
    nonisolated static func accountIsGone(_ error: Error) -> Bool {
        let nsError = error as NSError
        guard nsError.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: nsError.code) else { return false }
        if code == .internalError, let message = serverMessage(in: nsError) {
            return refusedSessionMessages.contains(message)
        }
        return [.userNotFound, .userDisabled, .userTokenExpired, .invalidUserToken].contains(code)
    }

    /// Server answers FirebaseAuth has no error code for, so it reports them as `internalError`. The Auth
    /// emulator answers a deleted user's refresh with INVALID_REFRESH_TOKEN.
    private nonisolated static let refusedSessionMessages: Set<String> = ["INVALID_REFRESH_TOKEN", "USER_DISABLED", "USER_NOT_FOUND"]

    /// The server's message, which FirebaseAuth keeps inside the `internalError`'s underlying error.
    private nonisolated static func serverMessage(in error: NSError) -> String? {
        let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError
        let response = underlying?.userInfo["FIRAuthErrorUserInfoDeserializedResponseKey"] as? [String: Any]
        return (response?["message"] as? String).map { $0.components(separatedBy: ":")[0].trimmingCharacters(in: .whitespaces) }
    }
}
