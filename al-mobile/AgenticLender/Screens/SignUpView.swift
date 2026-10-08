import SwiftUI

/// Two-step sign-up (Figma frames 04 to 05d): account, then contact and address details.
struct SignUpView: View {
    @State private var model: SignUpViewModel
    @FocusState private var focused: SignUpField?
    @State private var isPasswordVisible = false
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
                TextField("name@example.com", text: $model.form.email)
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
                passwordField
            }
            PasswordChecklist(rulesMet: model.passwordRulesMet)
        }
    }

    private var passwordField: some View {
        HStack {
            Group {
                if isPasswordVisible {
                    TextField("Password", text: $model.form.password)
                } else {
                    SecureField("Password", text: $model.form.password)
                }
            }
            .textContentType(.newPassword)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focused, equals: .password)
            .submitLabel(.continue)
            .onSubmit { model.continueFromAccount() }
            .accessibilityIdentifier("signUp.password")

            Button {
                isPasswordVisible.toggle()
            } label: {
                Image(systemName: isPasswordVisible ? "eye.slash" : "eye")
                    .frame(width: 44, height: 44)
            }
            .foregroundStyle(Theme.mutedText)
            .accessibilityLabel(isPasswordVisible ? "Hide password" : "Show password") // betterleaks:allow — button label, not a secret
        }
    }

    private var detailsFields: some View {
        VStack(alignment: .leading, spacing: 16) {
            FormField("Phone", error: model.visibleError(for: .phone), isDisabled: model.isSubmitting) {
                TextField("087 123 4567", text: $model.form.phone)
                    .textContentType(.telephoneNumber)
                    .keyboardType(.phonePad)
                    .focused($focused, equals: .phone)
                    .accessibilityIdentifier("signUp.phone")
            }
            FormField("Address line 1", error: model.visibleError(for: .addressLine1), isDisabled: model.isSubmitting) {
                TextField("Address line 1", text: $model.form.addressLine1)
                    .textContentType(.streetAddressLine1)
                    .focused($focused, equals: .addressLine1)
                    .accessibilityIdentifier("signUp.addressLine1")
            }
            FormField("Address line 2 (optional)", error: nil, isDisabled: model.isSubmitting) {
                TextField("Apartment, estate or area", text: $model.form.addressLine2)
                    .textContentType(.streetAddressLine2)
                    .accessibilityIdentifier("signUp.addressLine2")
            }
            FormField("County", error: model.visibleError(for: .county), isDisabled: model.isSubmitting) {
                countyButton
            }
            FormField("Eircode", error: model.visibleError(for: .eircode), isDisabled: model.isSubmitting) {
                TextField("A65 F4E2", text: $model.form.eircode)
                    .textContentType(.postalCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .eircode)
                    .accessibilityIdentifier("signUp.eircode")
            }
        }
        .disabled(model.isSubmitting)
    }

    private var countyButton: some View {
        Button {
            focused = nil
            isCountySheetShown = true
        } label: {
            HStack {
                Text(model.form.county?.name ?? "Choose county")
                    .foregroundStyle(model.form.county == nil ? Theme.mutedText : Theme.text)
                Spacer()
                Image(systemName: "chevron.down").foregroundStyle(Theme.mutedText)
            }
            .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("County, \(model.form.county?.name ?? "not chosen")")
        .accessibilityIdentifier("signUp.county")
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
        ContentUnavailableView(
            "Account created",
            systemImage: "checkmark.circle",
            description: Text("Next you'll choose your broker.")
        )
        .foregroundStyle(Theme.text)
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
