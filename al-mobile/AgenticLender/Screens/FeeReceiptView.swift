import SwiftUI

/// Figma 18 "Payment received": what was paid, for what, when, and the Stripe payment reference.
struct FeeReceiptView: View {
    @Environment(\.dismiss) private var dismiss
    let receipt: FeeReceipt
    /// "Ref 2026-0042", as the status screen shows it.
    let reference: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(Theme.pine).accessibilityHidden(true)
                Text("Payment received").font(.largeTitle.bold()).foregroundStyle(Theme.text).accessibilityAddTraits(.isHeader)
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        if index > 0 { Divider().overlay(Theme.line) }
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(row.0).foregroundStyle(Theme.mutedText)
                            Spacer(minLength: 8)
                            Text(row.1).foregroundStyle(Theme.text).multilineTextAlignment(.trailing)
                        }
                        .font(.body)
                        .padding(.horizontal, 16)
                        .frame(minHeight: Theme.minTapTarget + 8)
                        .accessibilityElement(children: .combine)
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                PrimaryButton(title: "Done") { dismiss() }.accessibilityIdentifier("fee.done")
                ShareLink(item: shareText) { Text("Share receipt").font(.headline).foregroundStyle(Theme.text) }
                    .frame(minHeight: Theme.minTapTarget)
            }
            .padding(Theme.screenPadding)
            .background(Theme.oat)
        }
        .accessibilityIdentifier("fee.receipt")
    }

    private var rows: [(String, String)] {
        [
            ("Amount", receipt.amountText),
            ("For", "Fast-track appraisal"),
            ("Application", reference.replacingOccurrences(of: "Ref ", with: "")),
            ("Date", receipt.paidAt?.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()) ?? "Today"),
            ("Payment reference", receipt.shortReference),
        ]
    }

    private var shareText: String {
        rows.map { "\($0.0): \($0.1)" }.joined(separator: "\n")
    }
}
