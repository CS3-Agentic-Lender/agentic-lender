import SwiftUI

@main
struct AgenticLenderApp: App {
    init() {
        FirebaseSetup.configure()
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                WelcomeView()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .signIn:
                            SignInView()
                        case .signUp:
                            SignUpView(service: FirebaseAccountService())
                        case .affordability:
                            // The result screen is the next affordability subtask; until then Calculate only checks the form.
                            AffordabilityFormView(onCalculate: { _ in })
                        }
                    }
            }
        }
    }
}
