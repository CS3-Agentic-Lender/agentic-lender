import SwiftUI

@main
struct AgenticLenderApp: App {
    @State private var session: AppSession

    init() {
        // Firebase has to be set up before the session asks it for the saved login.
        FirebaseSetup.configure()
        SessionCheck.useFirebase()
        UITestLaunch.apply()
        NavigationBarStyle.apply()
        _session = State(initialValue: AppSession(state: FirebaseSignedInState()))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch session.start {
                case .welcome:
                    NavigationStack { WelcomeView(googleService: FirebaseGoogleSignInService()).appRoutes() }
                case .home:
                    NavigationStack { HomeGateView().appRoutes() }
                case .main(let profile):
                    // Each tab has its own stack (AL-313), so the tabs aren't inside one.
                    MainTabView(profile: profile)
                }
            }
            // A new root after signing out, so nothing from the signed-in screens is left behind.
            .id(session.stackID)
            .environment(session)
        }
    }
}

extension View {
    /// The screens any stack can push with a `Route`: the root's, and each tab's (AL-313).
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .signIn:
                SignInView(service: FirebaseSignInService())
            case .resetPassword(let email):
                ResetPasswordView(service: FirebaseSignInService(), email: email)
            case .signUp:
                SignUpView(service: FirebaseAccountService())
            case .affordability:
                let service = APIAffordabilityService.live()
                LoanTypeChoiceView(affordabilityService: service, helocService: service)
            case .propertyCheck:
                PropertyCheckFormView(service: APIValuationService.live(), savedChecks: LiveSavedCheckService.live())
            case .properties:
                PropertiesView(service: LiveSavedCheckService.live())
            }
        }
    }
}
