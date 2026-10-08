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
                        }
                    }
            }
        }
    }
}
