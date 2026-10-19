import SwiftUI

#if DEBUG
/// Stands in for Google's account picker while the app runs on the Auth emulator.
/// Debug builds only, like `EmulatorGoogleToken`.
///
/// The deployed build will open the real Google sign-in here instead; whatever opens,
/// it hands back a `GoogleToken` and the rest of the flow stays the same.
struct TestGoogleAccountSheet: View {
    let onSignIn: (GoogleToken) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var name = ""
    @State private var emailError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Google email", text: $email, prompt: Text(verbatim: "name@gmail.com"))
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("testGoogle.email")
                    TextField("Name (optional)", text: $name)
                        .textContentType(.name)
                        .accessibilityIdentifier("testGoogle.name")
                } footer: {
                    if let emailError {
                        Text(emailError).foregroundStyle(Theme.error)
                    } else {
                        Text("Test sign-in for the local emulator. No real Google account is used, and the same email signs in to the same account each time.")
                    }
                }
            }
            .navigationTitle("Test Google sign-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sign in") { signIn() }
                        .accessibilityIdentifier("testGoogle.signIn")
                }
            }
        }
    }

    private func signIn() {
        emailError = Email.error(for: email)
        guard emailError == nil else { return }
        dismiss()
        onSignIn(EmulatorGoogleToken.make(email: email, name: name))
    }
}
#endif
