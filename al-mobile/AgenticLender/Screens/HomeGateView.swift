import SwiftUI

/// What a signed-in borrower sees first: the broker picker until they have a broker, then home.
/// Sign-up, Google sign-in, email sign-in and opening the app signed in all land here.
struct HomeGateView: View {
    @Environment(AppSession.self) private var session
    @State private var model: HomeGateViewModel
    private let service: ProfileService

    init(service: ProfileService) {
        self.service = service
        _model = State(initialValue: HomeGateViewModel(service: service))
    }

    /// The gate against Firebase and al-core.
    init() {
        self.init(service: FirebaseProfileService())
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                ProgressView("Loading your details")
                    .tint(Theme.pine)
                    .foregroundStyle(Theme.mutedText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .chooseBroker:
                BrokerPickerView(mode: .choose, service: service, onSaved: model.brokerChosen)
            case .home(let profile):
                HomeView(profile: profile, service: service)
            case .needsDetails(let user):
                GoogleProfileView(user: user, service: FirebaseGoogleSignInService())
            case .failed(let message):
                failed(message)
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        // Only the first time: coming back from a pushed screen keeps home as it was.
        .task {
            if model.state == .loading { await model.load() }
        }
    }

    /// Retry, and Sign out so a borrower is never stuck here.
    private func failed(_ message: String) -> some View {
        VStack(spacing: 8) {
            RetryMessage(message: message) {
                Task { await model.load() }
            }
            SecondaryButton(title: "Sign out") { session.signOut() }
                .padding(.horizontal, Theme.screenPadding)
                .accessibilityIdentifier("homeGate.signOut")
            if let error = session.signOutError {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .padding(.horizontal, Theme.screenPadding)
                    .accessibilityIdentifier("homeGate.signOutError")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
