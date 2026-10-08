import SwiftUI

/// Searchable list of the 26 counties (Figma frame 05c).
struct CountySheet: View {
    @Binding var selection: County?
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var counties: [County] {
        let search = query.trimmed
        guard !search.isEmpty else { return County.allCases }
        return County.allCases.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NavigationStack {
            List(counties) { county in
                Button {
                    selection = county
                    dismiss()
                } label: {
                    HStack {
                        Text(county.name)
                            .fontWeight(county == selection ? .semibold : .regular)
                        Spacer()
                        if county == selection {
                            Image(systemName: "checkmark").accessibilityHidden(true)
                        }
                    }
                    .foregroundStyle(Theme.text)
                    .contentShape(Rectangle())
                }
                .listRowBackground(Theme.surface)
                .accessibilityAddTraits(county == selection ? .isSelected : [])
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search counties")
            .navigationTitle("County")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Theme.pine)
                }
            }
        }
        .presentationDragIndicator(.visible)
    }
}

#Preview {
    CountySheet(selection: .constant(.cork))
}
