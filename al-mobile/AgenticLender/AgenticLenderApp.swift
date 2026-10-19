import SwiftUI

@main
struct AgenticLenderApp: App {
    @State private var session: AppSession

    init() {
        // Firebase has to be set up before the session asks it for the saved login.
        FirebaseSetup.configure()
        _session = State(initialValue: AppSession(state: FirebaseSignedInState()))
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Group {
                    switch session.start {
                    case .welcome:
                        WelcomeView(googleService: FirebaseGoogleSignInService())
                    case .home:
                        HomeGateView()
                    }
                }
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .signIn:
                        SignInView(service: FirebaseSignInService())
                    case .resetPassword(let email):
                        ResetPasswordView(service: FirebaseSignInService(), email: email)
                    case .signUp:
                        SignUpView(service: FirebaseAccountService())
                    case .affordability:
                        // The result screen is the next affordability subtask; until then Calculate only checks the form.
                        AffordabilityFormView(onCalculate: { _ in })
                    }
                }
            }
            // A new stack after signing out, so nothing from the signed-in screens is left behind.
            .id(session.stackID)
            .environment(session)
        }
    }
}
