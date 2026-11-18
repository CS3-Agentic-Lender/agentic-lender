import SwiftUI

/// Placeholder first screen. Real design comes from the AL-80 wireframes.
struct WelcomeView: View {
    @Environment(AppSession.self) private var session
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
            // Why the app signed the borrower out (AL-258).
            if let notice = session.welcomeNotice {
                Label(notice, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.text)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.tint, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("welcome.notice")
            }
            NavigationLink("Create account", value: Route.signUp)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("welcome.signUp")
            NavigationLink("Sign in", value: Route.signIn)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("welcome.signIn")
            // Figma 01 Welcome: Google sits under Create account and Sign in, for new and returning borrowers.
            // The hosted build uses Google's own sign-in (AL-320); a local Debug build uses the emulator stand-in;
            // a local Release build has neither, so it hides the button.
            if Self.showsGoogle {
            Button(google.isWorking ? "Signing in with Google..." : "Continue with Google") {
                continueWithGoogle()
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
        }
        .padding()
        .navigationTitle("Welcome")
        .navigationBarTitleDisplayMode(.inline)
        #if DEBUG
        .sheet(isPresented: $isGoogleSheetShown) {
            TestGoogleAccountSheet { token in
                Task { await google.continueWithGoogle(token) }
            }
        }
        #endif
        .navigationDestination(item: destination) { destination in
            switch destination {
            case .home:
                HomeGateView()
            case .profile(let user):
                ProfileDetailsView(user: user, service: googleService)
            }
        }
    }

    #if DEBUG
    private static let showsGoogle = true
    #else
    private static let showsGoogle = BackendTarget.current == .hosted
    #endif

    private func continueWithGoogle() {
        if BackendTarget.current == .hosted {
            Task { await google.continueWithGoogle(from: SDKGoogleTokenSource()) }
            return
        }
        #if DEBUG
        isGoogleSheetShown = true
        #endif
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
        .environment(AppSession(state: PreviewSignedInState()))
}
#endif
