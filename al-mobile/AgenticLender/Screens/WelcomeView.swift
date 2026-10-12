import SwiftUI

/// Placeholder first screen. Real design comes from the AL-80 wireframes.
struct WelcomeView: View {
    let googleService: GoogleSignInService

    @State private var google: GoogleSignInViewModel
    @State private var isGoogleSheetShown = false

    init(googleService: GoogleSignInService) {
        self.googleService = googleService
        _google = State(initialValue: GoogleSignInViewModel(service: googleService))
    }

    var body: some View {
        VStack(spacing: 16) {
            Text("Agentic Lender")
                .font(.largeTitle.bold())
            Text("Borrower app")
                .foregroundStyle(.secondary)
            NavigationLink("Create account", value: Route.signUp)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("welcome.signUp")
            NavigationLink("Sign in", value: Route.signIn)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("welcome.signIn")
            // Figma 01 Welcome: Google sits under Create account and Sign in, for new and returning borrowers.
            Button(google.isWorking ? "Signing in with Google..." : "Continue with Google") {
                isGoogleSheetShown = true
            }
            .buttonStyle(.bordered)
            .disabled(google.isWorking)
            .accessibilityIdentifier("welcome.google")
            if let error = google.errorMessage {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
            }
        }
        .padding()
        .navigationTitle("Welcome")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isGoogleSheetShown) {
            TestGoogleAccountSheet { token in
                Task { await google.continueWithGoogle(token) }
            }
        }
        .navigationDestination(item: destination) { destination in
            switch destination {
            case .home:
                SignedInPlaceholderView(title: "Signed in", message: "Welcome back.")
                    .navigationBarBackButtonHidden()
            case .profile(let user):
                GoogleProfileView(user: user, service: googleService)
            }
        }
    }

    private var destination: Binding<GoogleSignInViewModel.Destination?> {
        Binding(
            get: { google.destination },
            set: { if $0 == nil { google.leaveDestination() } }
        )
    }
}

#if DEBUG
private struct PreviewGoogleSignInService: GoogleSignInService {
    func signIn(with token: GoogleToken) async throws -> GoogleSignInOutcome { .signedIn }
    func completeProfile(_ profile: BorrowerProfile) async throws {}
}

#Preview {
    NavigationStack { WelcomeView(googleService: PreviewGoogleSignInService()) }
}
#endif
