import SwiftUI

/// The application form's way in to the saved checks (Figma 12, 12b): "Use a saved property" opens a
/// sheet of them, and picking one fills the home's details. With none saved, it offers "Check a property".
struct SavedCheckPicker: View {
    let store: SavedChecksStore
    let onPick: (SavedCheck) -> Void
    @State private var isSheetShown = false

    var body: some View {
        Group {
            if case .ready(let checks) = store.state, checks.isEmpty {
                noneSaved
            } else {
                useSaved
            }
        }
        .onAppear { store.start() }
        .sheet(isPresented: $isSheetShown) {
            SavedCheckSheet(store: store) { check in
                isSheetShown = false
                onPick(check)
            }
        }
    }

    private var useSaved: some View {
        Button { isSheetShown = true } label: {
            HStack {
                Text("Use a saved property")
                    .font(.headline)
                Spacer()
                Image(systemName: "chevron.right")
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Theme.pine)
            .padding(.horizontal, 14)
            .frame(minHeight: Theme.fieldHeight)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
        }
        .accessibilityHint("Fills the home's details from a property you checked")
        .accessibilityIdentifier("application.useSavedProperty")
    }

    /// Figma 12b.
    private var noneSaved: some View {
        HStack {
            Text("No properties checked yet")
                .foregroundStyle(Theme.mutedText)
            Spacer()
            NavigationLink(value: Route.propertyCheck) {
                Text("Check a property")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.pine)
                    .frame(minHeight: Theme.minTapTarget)
            }
            .accessibilityIdentifier("application.checkProperty")
        }
        .padding(.horizontal, 14)
        .frame(minHeight: Theme.fieldHeight)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
    }
}

/// The saved checks to pick from.
private struct SavedCheckSheet: View {
    let store: SavedChecksStore
    let onPick: (SavedCheck) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch store.state {
                case .loading:
                    ProgressView("Loading your properties").tint(Theme.pine)
                case .failed(let message):
                    RetryMessage(message: message) { store.start() }
                case .ready(let checks):
                    List(checks) { check in
                        Button { onPick(check) } label: { SavedCheckRow(check: check) }
                            .listRowBackground(Theme.surface)
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.oat.ignoresSafeArea())
            .navigationTitle("Your properties")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
