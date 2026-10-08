import Observation
import os

/// Drives "Reset password" and "Check your email" (Figma frames 03 and 03b).
///
/// An unknown email still shows "Check your email", so the screen never reveals
/// whether an account exists.
@MainActor
@Observable
final class ResetPasswordViewModel {
    var email: String
    private(set) var error: String?
    private(set) var isSending = false
    /// The address the link went to; set once the reset email has been sent.
    private(set) var sentTo: String?

    private let service: SignInService
    private let logger = Logger(category: "SignIn")

    init(service: SignInService, email: String = "") {
        self.service = service
        self.email = email
    }

    func sendLink() async {
        error = Email.error(for: email)
        guard error == nil else { return }

        let address = Email.normalized(email)
        isSending = true
        defer { isSending = false }
        do {
            try await service.sendPasswordReset(to: address)
            sentTo = address
        } catch SignInError.incorrectCredentials {
            sentTo = address
        } catch let failure as SignInError {
            error = failure.message
        } catch {
            logger.error("Unexpected password reset error: \(error.localizedDescription, privacy: .public)")
            self.error = SignInError.unknown.message
        }
    }
}
