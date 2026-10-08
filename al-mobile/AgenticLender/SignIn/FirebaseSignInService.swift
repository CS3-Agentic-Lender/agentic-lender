import FirebaseAuth
import os

/// Email and password sign-in and password reset through Firebase Auth.
struct FirebaseSignInService: SignInService {
    private let logger = Logger(subsystem: "ie.mtu.agenticlender", category: "SignIn")

    func signIn(email: String, password: String) async throws {
        do {
            _ = try await Auth.auth().signIn(withEmail: email, password: password)
        } catch {
            logger.error("Sign-in failed: \(error.localizedDescription, privacy: .public)")
            throw SignInError(authError: error)
        }
    }

    func sendPasswordReset(to email: String) async throws {
        do {
            try await Auth.auth().sendPasswordReset(withEmail: email)
        } catch {
            logger.error("Sending the password reset failed: \(error.localizedDescription, privacy: .public)")
            throw SignInError(authError: error)
        }
    }
}

extension SignInError {
    init(authError: Error) {
        let nsError = authError as NSError
        guard nsError.domain == AuthErrorDomain else {
            self = .unknown
            return
        }
        switch AuthErrorCode(rawValue: nsError.code) {
        case .wrongPassword, .userNotFound, .invalidCredential, .invalidEmail, .userDisabled:
            self = .incorrectCredentials
        case .tooManyRequests: self = .tooManyAttempts
        case .networkError: self = .network
        default: self = .unknown
        }
    }
}
