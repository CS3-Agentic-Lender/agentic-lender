import SwiftUI

/// Where a borrower lands once they have a broker (Figma Home, Sprint 1 content only):
/// a greeting, "What can I borrow?", Messages, their broker and Sign out. The application card joins it in Sprint 2.
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var model: HomeViewModel
    @State private var inbox: MessageInbox
    @State private var isChangingBroker = false
    @State private var isShowingMessages = false
    private let service: ProfileService

    /// `profile` is the one the gate loaded; `service` saves a change of broker; `messages` reads the
    /// thread with the broker, which Home keeps listening to for the unread count.
    init(profile: CoreProfile, service: ProfileService, messages: MessageService) {
        _model = State(initialValue: HomeViewModel(profile: profile))
        _inbox = State(initialValue: MessageInbox(service: messages))
        self.service = service
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                borrowCard
                propertyCheckCard
                messagesCard
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
        .navigationDestination(isPresented: $isShowingMessages) {
            MessagesView(inbox: inbox, brokerName: model.brokerName, brokerFirm: model.brokerFirm)
        }
        .task { await inbox.start() }
    }

    /// Opens the thread with the broker; shows how many replies are unread (Figma 15e's tab badge,
    /// until the app has a tab bar).
    private var messagesCard: some View {
        Button {
            isShowingMessages = true
        } label: {
            card(title: "Messages", detail: model.brokerName.map { "Talk to \($0) about your application." }, badge: unreadBadge)
        }
        .buttonStyle(.plain)
        .accessibilityValue(inbox.unreadCount == 0 ? "" : "\(inbox.unreadCount) unread")
        .accessibilityIdentifier("home.messages")
    }

    private var unreadBadge: String? {
        inbox.unreadCount == 0 ? nil : "\(inbox.unreadCount) new"
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
        NavigationLink(value: Route.propertyCheck) {
            card(title: "Check a property", detail: "See if an asking price is fair, from the home's details.")
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
    private func card(caption: String? = nil, title: String, detail: String?, badge: String? = nil) -> some View {
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
            if let badge {
                Text(badge)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.surface)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Theme.pine, in: Capsule())
                    .accessibilityHidden(true)
            }
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
            service: PreviewProfileService(),
            messages: PreviewMessageService()
        )
    }
    .environment(AppSession(state: PreviewSignedInState()))
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
}
#endif
