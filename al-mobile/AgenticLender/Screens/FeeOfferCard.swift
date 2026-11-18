import SwiftUI

/// The fast-track appraisal on the status screen (AL-148): the offer while the application waits for
/// the underwriter (Figma 16a), and "Fast-track paid" with the receipt once the fee is paid (18a).
struct FeeOfferCard: View {
    let section: ApplicationFee.Section
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            switch section {
            case .offer: offer
            case .paid(let paidAt): paid(paidAt)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(section == .offer ? "fee.offer" : "fee.paid")
    }

    private var offer: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "bolt")
                .font(.headline)
                .foregroundStyle(Theme.pine)
                .frame(width: 40, height: 40)
                .background(Theme.tint, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Speed up your valuation").font(.headline).foregroundStyle(Theme.text)
                Text("A valuer visits sooner with a fast-track appraisal.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedText)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text("€\(ApplicationFee.amountEur)").font(.system(.headline, design: .monospaced)).foregroundStyle(Theme.text)
                Text("See details").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.pine)
            }
        }
        .modifier(FeeCardStyle())
    }

    private func paid(_ paidAt: Date?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(Theme.pine)
                .accessibilityHidden(true)
            Text(["Fast-track paid", paidAt?.formatted(.dateTime.day().month(.abbreviated))].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer(minLength: 8)
            Text("View receipt").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.pine)
        }
        .modifier(FeeCardStyle())
    }
}

private struct FeeCardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
            .contentShape(Rectangle())
    }
}
