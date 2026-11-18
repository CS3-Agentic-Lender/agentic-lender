import SwiftUI

/// The Home tab (Figma Home, AL-313): a greeting, the application card (AL-104), "What can I borrow?"
/// and "Check a property". Messages, the broker and Sign out live in their own tabs now.
struct HomeView: View {
    let model: HomeViewModel
    let applicationCard: HomeApplicationCardModel
    /// Whether to show "Check your inbox" under the greeting (AL-311).
    let verification: EmailVerificationModel
    /// Opens the Property tab, so a borrower's properties live in one place.
    let onCheckProperty: () -> Void
    /// The application whose status is open; the status screen is pushed while this is set.
    @State private var statusApplicationID: String?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                if let message = verification.banner {
                    VerifyEmailBanner(model: verification, message: message)
                }
                HomeApplicationCard(model: applicationCard) { statusApplicationID = $0 }
                Text("Get started")
                    .font(.title3.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                borrowCard
                propertyCheckCard
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $statusApplicationID) { applicationID in
            ApplicationStatusView(applicationID: applicationID, service: FirestoreApplicationStatusService())
        }
        // A link opened in Mail counts as soon as the borrower is back: on opening Home and on returning to the app.
        .task { await verification.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await verification.refresh() } }
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
        Button(action: onCheckProperty) {
            card(title: "Check a property", detail: "See if an asking price is fair, and keep the homes you check.")
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.propertyCheck")
    }

    /// A tappable Surface card with a chevron, as on Figma Home.
    private func card(title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedText)
                    .multilineTextAlignment(.leading)
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
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
        .contentShape(Rectangle())
    }
}

#if DEBUG
/// A signed-in login for previews of screens that read the session.
struct PreviewSignedInState: SignedInState {
    var hasSignedInUser: Bool { true }
    func signOut() throws {}
    func onSignedOut(_ handler: @escaping @MainActor () -> Void) {}
}

#Preview {
    MainTabView(
        profile: CoreProfile(fullName: "Aoife Byrne", brokerID: "broker1", brokerName: "Bob Murphy", brokerFirm: "Murphy Mortgages"),
        service: PreviewProfileService(),
        messages: PreviewMessageService(),
        applications: PreviewHomeApplicationService(),
        verification: PreviewVerificationService()
    )
    .environment(AppSession(state: PreviewSignedInState()))
}

/// A password account whose email isn't verified yet, so the preview shows the banner (AL-311).
struct PreviewVerificationService: VerificationService {
    func reload() async throws -> VerificationAccount? {
        VerificationAccount(email: "aoife@test.com", hasPassword: true, isVerified: false)
    }

    func sendVerificationEmail() async throws {}
}

/// An application in AI review, for previews of Home.
struct PreviewHomeApplicationService: HomeApplicationService {
    func listen(onChange: @escaping (Result<HomeApplication?, ApplicationStatusError>) -> Void) -> LiveListener {
        onChange(.success(HomeApplication(id: "app1", fields: [
            "status": "AI Deliberated", "loanType": "mortgage", "loanAmountEur": 210_000.0, "termYears": 30,
        ])))
        return LiveListener {}
    }
}

/// A thread with one unread reply, for previews of Home and Messages.
@MainActor
final class PreviewMessageService: MessageService {
    var myID: String? { "borrower1" }

    func currentApplicationID() async throws -> String? { "app1" }

    func listen(to applicationID: String, onChange: @escaping (Result<[Message], MessageError>) -> Void) -> MessageListener {
        onChange(.success([
            Message(id: "1", senderID: "broker1", senderRole: .broker, text: "Hi Aoife, I've picked up your application.",
                    sentAt: .now.addingTimeInterval(-86_400), read: true),
            Message(id: "2", senderID: "borrower1", senderRole: .borrower, text: "Great, thanks Bob.",
                    sentAt: .now.addingTimeInterval(-86_000), read: true),
            Message(id: "3", senderID: "broker1", senderRole: .broker, text: "Quick question: is the €250 a month a car loan or a credit card?",
                    sentAt: .now.addingTimeInterval(-600), read: false),
        ]))
        return MessageListener {}
    }

    func send(_ text: String, on applicationID: String) async throws -> String {
        throw MessageError.network // shows the "Not sent" state in previews
    }

    func markRead(on applicationID: String) async throws {}
}
#endif
