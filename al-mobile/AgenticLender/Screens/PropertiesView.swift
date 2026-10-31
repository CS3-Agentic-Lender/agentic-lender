import SwiftUI

/// "Properties" (Figma 09 Saved checks, 09a No properties yet): the borrower's saved checks, live,
/// newest first, with "Check a property". Swipe a row to delete it. Opened from Home's "Check a
/// property" card until the app has a tab bar.
struct PropertiesView: View {
    @State private var store: SavedChecksStore

    init(service: SavedCheckService) {
        _store = State(initialValue: SavedChecksStore(service: service))
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.oat.ignoresSafeArea())
            .navigationTitle("Properties")
            .navigationBarTitleDisplayMode(.large)
            .onAppear { store.start() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .loading:
            ProgressView("Loading your properties")
                .tint(Theme.pine)
                .foregroundStyle(Theme.mutedText)
                .frame(maxHeight: .infinity)
        case .failed(let message):
            RetryMessage(message: message) { store.start() }
                .frame(maxHeight: .infinity)
        case .ready(let checks) where checks.isEmpty:
            NoPropertiesYet()
        case .ready(let checks):
            list(checks)
        }
    }

    private func list(_ checks: [SavedCheck]) -> some View {
        List {
            Section {
                NavigationLink(value: Route.propertyCheck) {
                    Text("Check a property")
                        .font(.headline)
                        .foregroundStyle(Theme.surface)
                        .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
                }
                .listRowBackground(Theme.pine)
                .accessibilityIdentifier("properties.check")
            }
            Section {
                ForEach(checks) { check in
                    SavedCheckRow(check: check)
                        .listRowBackground(Theme.surface)
                        .swipeActions {
                            Button("Delete", role: .destructive) {
                                Task { await store.delete(check) }
                            }
                        }
                }
            } footer: {
                if let error = store.deleteError {
                    Label(error, systemImage: "exclamationmark.circle")
                        .foregroundStyle(Theme.error)
                        .accessibilityIdentifier("properties.deleteError")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("properties.list")
    }
}

/// Figma 09a.
private struct NoPropertiesYet: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "house")
                .font(.largeTitle)
                .foregroundStyle(Theme.mutedText)
                .accessibilityHidden(true)
            Text("No properties yet")
                .font(.title3.bold())
                .foregroundStyle(Theme.text)
            Text("Check a home's fair price before you make an offer.")
                .font(.body)
                .foregroundStyle(Theme.mutedText)
                .multilineTextAlignment(.center)
            NavigationLink(value: Route.propertyCheck) {
                Text("Check a property")
                    .font(.headline)
                    .foregroundStyle(Theme.surface)
                    .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
                    .background(Theme.pine, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
            }
            .padding(.top, 8)
            .accessibilityIdentifier("properties.checkEmpty")
        }
        .padding(32)
        .frame(maxHeight: .infinity)
        // A container, so the button inside keeps its own identifier.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("properties.empty")
    }
}

/// One saved check: name and details on the left, the estimate and Fair or Over-priced on the right (Figma 09).
struct SavedCheckRow: View {
    let check: SavedCheck

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(check.title)
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                Text(check.details)
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedText)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Text(check.estimate)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .fixedSize()
                if let verdict = check.verdict {
                    VerdictBadge(verdict: verdict)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("savedCheck.row")
    }
}
