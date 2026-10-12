import SwiftUI

/// "What can I borrow?" choice between a mortgage and a HELOC (Figma frame 07h Mortgage or HELOC).
/// Mortgage opens the affordability form unchanged.
struct LoanTypeChoiceView: View {
    let affordabilityService: AffordabilityService

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("What can I borrow?")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Text("Choose what you want to borrow. You can change this later.")
                    .foregroundStyle(Theme.mutedText)
                    .padding(.bottom, 4)

                ForEach(LoanType.available(hasHELOCCheck: false), id: \.self) { loanType in
                    NavigationLink {
                        destination(for: loanType)
                    } label: {
                        ChoiceCard(title: loanType.title, detail: loanType.detail)
                    }
                    .accessibilityIdentifier("loanType.\(loanType.rawValue)")
                }
            }
            .padding(Theme.screenPadding)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func destination(for loanType: LoanType) -> some View {
        switch loanType {
        case .mortgage: AffordabilityFormView(service: affordabilityService)
        case .heloc: HELOCCheckFormView()
        }
    }
}

/// A tappable card with a heading, a short explanation and a chevron (Figma 07h).
private struct ChoiceCard: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).foregroundStyle(Theme.text)
                Text(detail).font(.footnote).foregroundStyle(Theme.mutedText)
            }
            .multilineTextAlignment(.leading)
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(Theme.mutedText)
        }
        .padding(Theme.screenPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack { LoanTypeChoiceView(affordabilityService: APIAffordabilityService.live()) }
}
