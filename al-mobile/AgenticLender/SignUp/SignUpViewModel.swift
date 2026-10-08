import Observation
import os

/// Drives the two sign-up steps: which errors show, moving between steps, and creating the account.
///
/// An error only shows once the borrower has left that field or pressed Continue,
/// then it updates as they type. An error from Firebase about one field (such as an
/// email already in use) shows under that field until the borrower changes it.
@MainActor
@Observable
final class SignUpViewModel {
    var form = SignUpForm()
    private(set) var step: SignUpStep = .account
    private(set) var isSubmitting = false
    private(set) var isAccountCreated = false
    private(set) var submitError: String?
    private var touched: Set<SignUpField> = []
    /// The last error Firebase returned about a field, with the form it rejected.
    private var rejection: (error: AccountError, form: SignUpForm)?

    private let service: AccountService
    private let logger = Logger(category: "SignUp")

    init(service: AccountService) {
        self.service = service
    }

    func visibleError(for field: SignUpField) -> String? {
        guard touched.contains(field) else { return nil }
        return SignUpValidator.error(for: field, in: form) ?? rejectionMessage(for: field)
    }

    private func rejectionMessage(for field: SignUpField) -> String? {
        guard let rejection, rejection.error.field == field else { return nil }
        let isUnchanged = switch field {
        case .email: form.email == rejection.form.email
        case .password: form.password == rejection.form.password
        default: false
        }
        return isUnchanged ? rejection.error.message : nil
    }

    /// The checklist under the password field ticks these off as the borrower types.
    var passwordRulesMet: Set<PasswordRule> {
        PasswordRule.met(by: form.password)
    }

    /// Continue stays disabled until the password meets every rule.
    var canContinueFromAccount: Bool {
        PasswordRule.allMet(by: form.password)
    }

    func markTouched(_ field: SignUpField) {
        touched.insert(field)
    }

    func continueFromAccount() {
        touched.formUnion(SignUpStep.account.fields)
        guard SignUpValidator.errors(for: form, on: .account).isEmpty else { return }
        step = .details
    }

    func backToAccount() {
        step = .account
    }

    func submit() async {
        touched.formUnion(SignUpField.allCases)
        submitError = nil
        guard SignUpValidator.errors(for: form).isEmpty else { return }

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await service.createAccount(NewAccount(form: form))
            isAccountCreated = true
        } catch let error as AccountError {
            show(error)
        } catch {
            logger.error("Unexpected sign-up error: \(error.localizedDescription, privacy: .public)")
            submitError = AccountError.unknown.message
        }
    }

    /// Field errors go back to the step with that field; the rest show above Continue.
    private func show(_ error: AccountError) {
        guard let field = error.field else {
            submitError = error.message
            return
        }
        rejection = (error, form)
        if SignUpStep.account.fields.contains(field) { step = .account }
    }
}
