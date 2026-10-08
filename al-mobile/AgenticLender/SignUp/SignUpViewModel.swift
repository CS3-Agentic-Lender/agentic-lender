import Observation

/// Drives the two sign-up steps: which errors show, moving between steps, and creating the account.
///
/// An error only shows once the borrower has left that field or pressed Continue,
/// then it updates as they type.
@MainActor
@Observable
final class SignUpViewModel {
    var form = SignUpForm()
    private(set) var step: SignUpStep = .account
    private(set) var isSubmitting = false
    private(set) var isAccountCreated = false
    private(set) var submitError: String?
    private var touched: Set<SignUpField> = []

    private let service: AccountService

    init(service: AccountService) {
        self.service = service
    }

    func visibleError(for field: SignUpField) -> String? {
        guard touched.contains(field) else { return nil }
        return SignUpValidator.error(for: field, in: form)
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
            submitError = error.message
        } catch {
            submitError = AccountError.unknown.message
        }
    }
}
