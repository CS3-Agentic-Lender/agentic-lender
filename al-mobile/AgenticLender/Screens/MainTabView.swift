import SwiftUI

/// The tab bar (AL-313, Figma): Home, Property, Messages with its unread badge, and Profile, each with
/// its own navigation stack so switching tabs keeps every tab where it was left. It owns what more than
/// one tab reads: the borrower's profile, the application on Home's card and the message thread.
struct MainTabView: View {
    @Environment(AppSession.self) private var session
    @State private var tabs = MainTabs()
    @State private var model: HomeViewModel
    @State private var inbox: MessageInbox
    @State private var applicationCard: HomeApplicationCardModel
    private let service: ProfileService

    /// The tabs against Firebase and the API.
    @MainActor
    init(profile: CoreProfile) {
        self.init(
            profile: profile, service: FirebaseProfileService(), messages: FirestoreMessageService(),
            applications: FirestoreHomeApplicationService()
        )
    }

    init(profile: CoreProfile, service: ProfileService, messages: MessageService, applications: HomeApplicationService) {
        _model = State(initialValue: HomeViewModel(profile: profile))
        _inbox = State(initialValue: MessageInbox(service: messages))
        _applicationCard = State(initialValue: HomeApplicationCardModel(service: applications))
        self.service = service
    }

    var body: some View {
        TabView(selection: $tabs.selected) {
            NavigationStack {
                HomeView(model: model, applicationCard: applicationCard) { tabs.checkProperty() }
                    .appRoutes()
            }
            // A submitted application returns here from its first screen; the other tabs keep their place.
            .id(session.homeResetCount)
            .tabItem { Label("Home", systemImage: "house") }
            .tag(MainTabs.Tab.home)
            .accessibilityIdentifier("tab.home")

            NavigationStack {
                PropertiesView(service: LiveSavedCheckService.live()).appRoutes()
            }
            .tabItem { Label("Property", systemImage: "building.2") }
            .tag(MainTabs.Tab.property)

            NavigationStack {
                MessagesView(inbox: inbox, brokerName: model.brokerName, brokerFirm: model.brokerFirm)
            }
            .tabItem { Label("Messages", systemImage: "bubble") }
            .tag(MainTabs.Tab.messages)
            .badge(MainTabs.messagesBadge(unread: inbox.unreadCount))

            NavigationStack {
                ProfileView(model: model, email: service.signedInUser?.email, service: service, applicationID: applicationID)
            }
            .tabItem { Label("Profile", systemImage: "person.crop.circle") }
            .tag(MainTabs.Tab.profile)
        }
        .tint(Theme.pine)
        // Home's card and the Messages badge are live from the start, whichever tab is open.
        .task { await inbox.start() }
        .onChange(of: session.homeResetCount) { tabs.returnedHome() }
    }

    /// The newest application on Home's card, for the support form's reference toggle.
    private var applicationID: String? {
        if case .application(let application) = applicationCard.state { application.id } else { nil }
    }
}
