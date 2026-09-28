import SwiftUI

@main
struct AgenticLenderApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                WelcomeView()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .signIn:
                            SignInView()
                        }
                    }
            }
        }
    }
}
