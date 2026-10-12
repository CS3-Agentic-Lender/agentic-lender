import SwiftUI

/// Two-step sign-up (Figma frames 04 to 05d): account, then contact and address details.
struct SignUpView: View {
    @State private var model: SignUpViewModel
    @FocusState private var focused: SignUpField?
    @State private var isCountySheetShown = false

    init(service: AccountService) {
        _model = State(initialValue: SignUpViewModel(service: service))
    }

    var body: some View {
        Group {
            if model.isAccountCreated {
                accountCreated
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        switch model.step {
                        case .account: accountFields
                        case .details: detailsFields
                        }
                    }
                    .padding(Theme.screenPadding)
                }
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom) { footer }
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.step == .details || model.isAccountCreated)
        .toolbar {
            if model.step == .details && !model.isAccountCreated {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        model.backToAccount()
                    } label: {
                        Label("Back", systemImage: "chevron.left").labelStyle(.titleAndIcon)
                    }
                    .foregroundStyle(Theme.text)
                    .disabled(model.isSubmitting)
                }
            }
        }
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
        .sheet(isPresented: $isCountySheetShown, onDismiss: { model.markTouched(.county) }) {
            CountySheet(selection: $model.form.county)
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.step == .account ? "Step 1 of 2" : "Step 2 of 2")
                .font(.footnote)
                .foregroundStyle(Theme.mutedText)
            Text(model.step == .account ? "Create account" : "Your details")
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var accountFields: some View {
        VStack(alignment: .leading, spacing: 16) {
            FormField("Full name", error: model.visibleError(for: .fullName)) {
                TextField("Full name", text: $model.form.fullName)
                    .textContentType(.name)
                    .focused($focused, equals: .fullName)
                    .submitLabel(.next)
                    .onSubmit { focused = .email }
                    .accessibilityIdentifier("signUp.fullName")
            }
            FormField("Email", error: model.visibleError(for: .email)) {
                TextField("Email", text: $model.form.email, prompt: Text(verbatim: "name@example.com"))
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focused = .password }
                    .accessibilityIdentifier("signUp.email")
            }
            // The checklist explains a weak password, so only a missing one gets an error line.
            FormField("Password", error: model.form.password.isEmpty ? model.visibleError(for: .password) : nil) {
                PasswordField(
                    text: $model.form.password,
                    contentType: .newPassword,
                    focus: $focused,
                    field: .password,
                    identifier: "signUp.password"
                )
                .submitLabel(.continue)
                .onSubmit { model.continueFromAccount() }
            }
            PasswordChecklist(rulesMet: model.passwordRulesMet)
        }
    }

    private var detailsFields: some View {
        ProfileDetailsFields(
            form: $model.form,
            error: model.visibleError(for:),
            focus: $focused,
            isDisabled: model.isSubmitting,
            chooseCounty: { isCountySheetShown = true }
        )
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let submitError = model.submitError {
                Label(submitError, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            PrimaryButton(
                title: model.isSubmitting ? "Creating account..." : "Continue",
                isLoading: model.isSubmitting,
                isEnabled: model.step == .details || model.canContinueFromAccount
            ) {
                focused = nil
                switch model.step {
                case .account: model.continueFromAccount()
                case .details: Task { await model.submit() }
                }
            }
            .accessibilityIdentifier("signUp.continue")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    /// Shown until choosing a broker is built as the next step after sign-up.
    private var accountCreated: some View {
        SignedInPlaceholderView(title: "Account created", message: "Next you'll choose your broker.")
    }
}

#if DEBUG
private struct PreviewAccountService: AccountService {
    func createAccount(_ account: NewAccount) async throws -> String { "preview-uid" }
}

#Preview {
    NavigationStack { SignUpView(service: PreviewAccountService()) }
}
#endif
