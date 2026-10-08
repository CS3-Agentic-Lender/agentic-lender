import SwiftUI

/// Where a borrower lands after signing up or signing in, until the home screen is built.
struct SignedInPlaceholderView: View {
    let title: String
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "checkmark.circle")
        } description: {
            Text(message)
        } actions: {
            NavigationLink("What can I borrow?", value: Route.affordability)
                .buttonStyle(.borderedProminent)
                .tint(Theme.pine)
                .accessibilityIdentifier("signedIn.affordability")
        }
        .foregroundStyle(Theme.text)
    }
}
