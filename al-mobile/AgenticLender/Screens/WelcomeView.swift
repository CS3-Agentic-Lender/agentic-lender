import SwiftUI

/// Placeholder first screen. Real design comes from the AL-80 wireframes.
struct WelcomeView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Agentic Lender")
                .font(.largeTitle.bold())
            Text("Borrower app")
                .foregroundStyle(.secondary)
            NavigationLink("Sign in", value: Route.signIn)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("welcome.signIn")
        }
        .padding()
        .navigationTitle("Welcome")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack { WelcomeView() }
}
