import SwiftUI

/// Email and password sign-in (Figma "Sign in (error state)" and 02a Signing in).
struct SignInView: View {
    private enum Field: Hashable { case email, password }

    @State private var model: SignInViewModel
    @FocusState private var focused: Field?

    init(service: SignInService) {
        _model = State(initialValue: SignInViewModel(service: service))
    }

    var body: some View {
        Group {
            if model.isSignedIn {
                SignedInPlaceholderView(title: "Signed in", message: "Welcome back.")
            } else {
                form
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.isSignedIn)
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Sign in")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                FormField("Email", error: model.emailError, isDisabled: model.isSubmitting) {
                    TextField("Email", text: $model.email, prompt: Text(verbatim: "name@example.com"))
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focused = .password }
                        .accessibilityIdentifier("signIn.email")
                }
                // The sign-in error sits under the password field, as in Figma.
                FormField("Password", error: model.passwordError ?? model.signInError, isDisabled: model.isSubmitting) {
                    PasswordField(
                        text: $model.password,
                        contentType: .password,
                        focus: $focused,
                        field: .password,
                        identifier: "signIn.password"
                    )
                    .submitLabel(.go)
                    .onSubmit { submit() }
                }
                HStack {
                    Spacer()
                    NavigationLink("Forgot password?", value: Route.resetPassword(email: model.normalizedEmail))
                        .foregroundStyle(Theme.text)
                        .frame(minHeight: Theme.minTapTarget)
                        .accessibilityIdentifier("signIn.forgotPassword")
                }
            }
            .padding(Theme.screenPadding)
            .disabled(model.isSubmitting)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            PrimaryButton(title: model.isSubmitting ? "Signing in..." : "Sign in", isLoading: model.isSubmitting) {
                submit()
            }
            .accessibilityIdentifier("signIn.submit")
            .padding(Theme.screenPadding)
            .background(Theme.oat)
        }
    }

    private func submit() {
        focused = nil
        Task { await model.signIn() }
    }
}

#if DEBUG
private struct PreviewSignInService: SignInService {
    func signIn(email: String, password: String) async throws { throw SignInError.incorrectCredentials }
    func sendPasswordReset(to email: String) async throws {}
}

#Preview {
    NavigationStack { SignInView(service: PreviewSignInService()) }
}
#endif
