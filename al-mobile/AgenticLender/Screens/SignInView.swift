import SwiftUI

/// Placeholder sign-in screen. Firebase Auth sign-in is built on the register / log in story.
struct SignInView: View {
    var body: some View {
        ContentUnavailableView(
            "Sign in",
            systemImage: "person.crop.circle",
            description: Text("Email and Google sign-in will go here.")
        )
        .navigationTitle("Sign in")
    }
}

#Preview {
    NavigationStack { SignInView() }
}
