import SwiftUI

/// "Your details" (Figma 05b): the profile a signed-in borrower fills in before reaching home when
/// they have none yet, either a first-time Google user or an email sign-up that stopped before the
/// profile was saved. The email is the signed-in account's and can't be changed.
struct ProfileDetailsView: View {
    @State private var model: ProfileDetailsViewModel
    @FocusState private var focused: SignUpField?
    @State private var isCountySheetShown = false

    init(user: GoogleUser, service: GoogleSignInService) {
        _model = State(initialValue: ProfileDetailsViewModel(user: user, service: service))
    }

    var body: some View {
        Group {
            if model.isProfileSaved {
                HomeGateView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        FormField("Full name", error: model.visibleError(for: .fullName), isDisabled: model.isSubmitting) {
                            TextField("Full name", text: $model.form.fullName)
                                .textContentType(.name)
                                .focused($focused, equals: .fullName)
                                .accessibilityIdentifier("googleProfile.fullName")
                        }
                        ProfileDetailsFields(
                            form: $model.form,
                            error: model.visibleError(for:),
                            focus: $focused,
                            isDisabled: model.isSubmitting,
                            chooseCounty: { isCountySheetShown = true },
                            idPrefix: "googleProfile"
                        )
                    }
                    .padding(Theme.screenPadding)
                }
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom) { footer }
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.isSubmitting || model.isProfileSaved)
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
        .sheet(isPresented: $isCountySheetShown, onDismiss: { model.markTouched(.county) }) {
            CountySheet(selection: $model.form.county)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Your details")
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            // The email is the signed-in account's and can't be changed here.
            Label("Signed in as \(model.email)", systemImage: "person.crop.circle")
                .font(.footnote)
                .foregroundStyle(Theme.mutedText)
                .accessibilityIdentifier("googleProfile.email")
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let submitError = model.submitError {
                Label(submitError, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            PrimaryButton(title: model.isSubmitting ? "Saving..." : "Continue", isLoading: model.isSubmitting) {
                focused = nil
                Task { await model.submit() }
            }
            .accessibilityIdentifier("googleProfile.continue")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }
}

#if DEBUG
private struct PreviewGoogleSignInService: GoogleSignInService {
    func signIn(with token: GoogleToken) async throws -> GoogleSignInOutcome { .signedIn }
    func completeProfile(_ profile: BorrowerProfile) async throws {}
}

#Preview {
    NavigationStack {
        ProfileDetailsView(user: GoogleUser(email: "alice@gmail.com", name: "Alice Murphy"), service: PreviewGoogleSignInService())
    }
}
#endif
