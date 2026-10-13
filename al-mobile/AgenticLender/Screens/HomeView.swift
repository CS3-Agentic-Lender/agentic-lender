import SwiftUI

/// Where a borrower lands after signing up or signing in (Figma Home, Sprint 1 content only):
/// a greeting, "What can I borrow?" and Sign out. The application card joins it in Sprint 2.
struct HomeView: View {
    @State private var model: HomeViewModel

    init(loadFullName: @escaping () async throws -> String, onSignOut: @escaping () -> Void) {
        _model = State(initialValue: HomeViewModel(loadFullName: loadFullName, onSignOut: onSignOut))
    }

    /// Home against Firebase and al-core.
    init() {
        // Signing out (Firebase sign-out, back to Welcome) is the stay-signed-in subtask's job;
        // until it lands, the button is in place and does nothing.
        self.init(loadFullName: { try await FirebaseHomeProfile.loadFullName() }, onSignOut: {})
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                borrowCard
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) { footer }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            // A stand-in of similar width keeps the layout still while the name loads.
            Text(model.isLoading ? "Hello, Aoife" : model.greeting)
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.text)
                .redacted(reason: model.isLoading ? .placeholder : [])
                .accessibilityLabel(model.isLoading ? "Loading" : model.greeting)
                .accessibilityAddTraits(.isHeader)
            Text("What would you like to do?")
                .font(.body)
                .foregroundStyle(Theme.mutedText)
        }
    }

    private var borrowCard: some View {
        NavigationLink(value: Route.affordability) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What can I borrow?")
                        .font(.headline)
                        .foregroundStyle(Theme.text)
                    Text("See how much you could borrow from your income, debts and deposit.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
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
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.affordability")
    }

    private var footer: some View {
        Button {
            model.signOut()
        } label: {
            Text("Sign out")
                .font(.headline)
                .foregroundStyle(Theme.pine)
                .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.signOut")
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        HomeView(loadFullName: { "Aoife Byrne" }, onSignOut: {})
    }
}
#endif
