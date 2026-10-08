import Observation
import os

/// Drives the sign-in screen (Figma "Sign in (error state)" and 02a Signing in).
@MainActor
@Observable
final class SignInViewModel {
    var email = "" { didSet { signInError = nil } }
    var password = "" { didSet { signInError = nil } }
    private(set) var emailError: String?
    private(set) var passwordError: String?
    private(set) var signInError: String?
    private(set) var isSubmitting = false
    private(set) var isSignedIn = false

    private let service: SignInService
    private let logger = Logger(category: "SignIn")

    init(service: SignInService) {
        self.service = service
    }

    /// The email as Firebase expects it: trimmed and lower case.
    var normalizedEmail: String { Email.normalized(email) }

    func signIn() async {
        emailError = Email.error(for: email)
        passwordError = password.isEmpty ? "Enter your password" : nil
        guard emailError == nil, passwordError == nil else { return }

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await service.signIn(email: normalizedEmail, password: password)
            isSignedIn = true
        } catch let error as SignInError {
            signInError = error.message
        } catch {
            logger.error("Unexpected sign-in error: \(error.localizedDescription, privacy: .public)")
            signInError = SignInError.unknown.message
        }
    }
}
