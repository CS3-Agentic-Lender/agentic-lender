import SwiftUI

/// Where a borrower lands once they have a broker (Figma Home, Sprint 1 content only):
/// a greeting, "What can I borrow?", their broker and Sign out. The application card joins it in Sprint 2.
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var model: HomeViewModel
    @State private var isChangingBroker = false
    private let service: ProfileService

    /// `profile` is the one the gate loaded; `service` saves a change of broker.
    init(profile: CoreProfile, service: ProfileService) {
        _model = State(initialValue: HomeViewModel(profile: profile))
        self.service = service
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                borrowCard
                propertyCheckCard
                brokerCard
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) { footer }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $isChangingBroker) {
            BrokerPickerView(mode: .change(current: model.profile), service: service) { profile in
                model.brokerChanged(profile)
                isChangingBroker = false
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.greeting)
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text("What would you like to do?")
                .font(.body)
                .foregroundStyle(Theme.mutedText)
        }
    }

    private var borrowCard: some View {
        NavigationLink(value: Route.affordability) {
            card(title: "What can I borrow?", detail: "See how much you could borrow from your income, debts and deposit.")
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.affordability")
    }

    private var propertyCheckCard: some View {
        NavigationLink(value: Route.properties) {
            card(title: "Check a property", detail: "See if an asking price is fair, and keep the homes you check.")
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.propertyCheck")
    }

    private var brokerCard: some View {
        Button {
            isChangingBroker = true
        } label: {
            card(caption: "Your broker", title: model.brokerName ?? "", detail: model.brokerFirm)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Change broker")
        .accessibilityIdentifier("home.broker")
    }

    /// A tappable Surface card with a chevron, as on Figma Home.
    private func card(caption: String? = nil, title: String, detail: String?) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                if let caption {
                    Text(caption)
                        .font(.footnote)
                        .foregroundStyle(Theme.mutedText)
                }
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                if let detail, !detail.trimmed.isEmpty {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                        .multilineTextAlignment(.leading)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.pine)
                .accessibilityHidden(true)
        }
        .padding(Theme.screenPadding)
        .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
        .contentShape(Rectangle())
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let error = session.signOutError {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            SecondaryButton(title: "Sign out") { session.signOut() }
                .accessibilityIdentifier("home.signOut")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }
}

#if DEBUG
/// A signed-in login for previews of screens that read the session.
struct PreviewSignedInState: SignedInState {
    var hasSignedInUser: Bool { true }
    func signOut() throws {}
}

#Preview {
    NavigationStack {
        HomeView(
            profile: CoreProfile(fullName: "Aoife Byrne", brokerID: "broker1", brokerName: "Bob Murphy", brokerFirm: "Murphy Mortgages"),
            service: PreviewProfileService()
        )
    }
    .environment(AppSession(state: PreviewSignedInState()))
}
#endif
