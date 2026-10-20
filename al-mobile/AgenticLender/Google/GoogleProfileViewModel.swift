import Observation
import os

/// Drives the profile screen a first-time Google user fills in before reaching home.
///
/// The fields and rules are sign-up's, without a password. The email is the Google one and
/// can't be changed: al-core rejects a profile whose email differs from the token's.
@MainActor
@Observable
final class GoogleProfileViewModel {
    var form: SignUpForm
    let email: String
    private(set) var isSubmitting = false
    private(set) var isProfileSaved = false
    private(set) var submitError: String?
    private var touched: Set<SignUpField> = []

    private let service: GoogleSignInService
    private let logger = Logger(category: "GoogleSignIn")

    init(user: GoogleUser, service: GoogleSignInService) {
        email = user.email
        form = SignUpForm(fullName: user.name, email: user.email)
        self.service = service
    }

    func visibleError(for field: SignUpField) -> String? {
        guard touched.contains(field), SignUpValidator.profileFields.contains(field) else { return nil }
        return SignUpValidator.error(for: field, in: form)
    }

    func markTouched(_ field: SignUpField) {
        touched.insert(field)
    }

    func submit() async {
        touched.formUnion(SignUpValidator.profileFields)
        submitError = nil
        var checked = form
        checked.email = email
        guard let profile = BorrowerProfile(form: checked) else { return }

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await service.completeProfile(profile)
            isProfileSaved = true
        } catch let error as AccountError {
            submitError = error.message
        } catch {
            logger.error("Unexpected error saving the Google profile: \(error.localizedDescription, privacy: .public)")
            submitError = AccountError.unknown.message
        }
    }
}
