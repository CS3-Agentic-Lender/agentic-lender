import Observation

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

    init(service: SignInService, email: String = "") {
        self.service = service
        self.email = email
    }

    func sendLink() async {
        error = SignInViewModel.emailError(for: email)
        guard error == nil else { return }

        let address = email.trimmed.lowercased()
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
            self.error = SignInError.unknown.message
        }
    }
}
