/// Signs a borrower in and sends password reset emails.
protocol SignInService: Sendable {
    func signIn(email: String, password: String) async throws
    func sendPasswordReset(to email: String) async throws
}

/// Why sign-in or a reset failed, with a message the borrower can act on.
///
/// A wrong password and an unknown email are both `incorrectCredentials`,
/// so the app never reveals which accounts exist.
enum SignInError: Error, Equatable {
    case incorrectCredentials
    case tooManyAttempts
    case network
    case unknown

    var message: String {
        switch self {
        case .incorrectCredentials:
            "Email or password is incorrect"
        case .tooManyAttempts:
            "Too many attempts. Try again in a few minutes, or reset your password."
        case .network:
            "Can't reach the server. Check your connection and try again."
        case .unknown:
            "Something went wrong signing in. Try again."
        }
    }
}
