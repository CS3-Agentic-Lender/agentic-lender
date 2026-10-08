import SwiftUI

/// "Reset password" then "Check your email" (Figma frames 03 and 03b).
struct ResetPasswordView: View {
    @State private var model: ResetPasswordViewModel
    @Environment(\.dismiss) private var dismiss

    init(service: SignInService, email: String) {
        _model = State(initialValue: ResetPasswordViewModel(service: service, email: email))
    }

    var body: some View {
        Group {
            if let sentTo = model.sentTo {
                checkYourEmail(sentTo)
            } else {
                form
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.sentTo != nil)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reset password")
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text("Enter your account email and we'll send you a link to choose a new password.")
                .foregroundStyle(Theme.mutedText)
            FormField("Email", error: model.error, isDisabled: model.isSending) {
                TextField("Email", text: $model.email, prompt: Text(verbatim: "name@example.com"))
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit { Task { await model.sendLink() } }
                    .accessibilityIdentifier("resetPassword.email")
            }
            .disabled(model.isSending)
            Spacer()
            PrimaryButton(title: "Send link", isLoading: model.isSending) {
                Task { await model.sendLink() }
            }
            .accessibilityIdentifier("resetPassword.send")
        }
        .padding(Theme.screenPadding)
    }

    private func checkYourEmail(_ address: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "envelope")
                .font(.title2)
                .foregroundStyle(Theme.text)
                .frame(width: 72, height: 72)
                .background(Theme.tint)
                .clipShape(Circle())
                .accessibilityHidden(true)
            Text("Check your email")
                .font(.title2.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text("If an account exists for \(Text(address).bold()), a reset link is on its way.")
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.mutedText)
            Spacer()
            PrimaryButton(title: "Back to sign in") { dismiss() }
                .accessibilityIdentifier("resetPassword.backToSignIn")
        }
        .padding(Theme.screenPadding)
    }
}

#if DEBUG
private struct PreviewResetService: SignInService {
    func signIn(email: String, password: String) async throws {}
    func sendPasswordReset(to email: String) async throws {}
}

#Preview {
    NavigationStack { ResetPasswordView(service: PreviewResetService(), email: "alice@test.com") }
}
#endif
