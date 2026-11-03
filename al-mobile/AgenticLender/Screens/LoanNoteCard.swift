import SwiftUI

/// Figma 14c: the loan note under the status timeline. Once minted it lists the note's token ID and
/// terms, then "View on block explorer"; on the local chain, which has no explorer, the transaction
/// hash instead. Before minting it says the note will appear here.
struct LoanNoteCard: View {
    let section: LoanNoteSection
    /// `BackendConfig.blockExplorerTxURL`; nil on the local chain.
    var explorerTxURL: String? = BackendConfig().blockExplorerTxURL

    var body: some View {
        switch section {
        case .hidden:
            EmptyView()
        case .waiting:
            card {
                Text(LoanNoteSection.waitingText)
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("status.loanNote.waiting")
        case .minted(let note):
            card { minted(note) }
                .accessibilityIdentifier("status.loanNote")
        }
    }

    private func card(@ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Loan note")
                .font(.headline)
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.screenPadding)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
        // A container, so the rows and the link inside keep their own identifiers.
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func minted(_ note: LoanNote) -> some View {
        VStack(spacing: 10) {
            ForEach(note.rows(), id: \.title) { row in
                HStack(alignment: .firstTextBaseline) {
                    Text(row.title)
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                    Spacer(minLength: 12)
                    Text(row.value)
                        .font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(Theme.text)
                        .multilineTextAlignment(.trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("status.loanNote.row")
            }
        }
        Divider().overlay(Theme.line)
        if let url = note.explorerURL(transactionBase: explorerTxURL) {
            Link(destination: url) {
                Label("View on block explorer", systemImage: "arrow.up.right.square")
                    .labelStyle(TrailingIconLabelStyle())
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .frame(minHeight: Theme.minTapTarget)
            }
            .accessibilityHint("Opens the mint transaction in your browser")
            .accessibilityIdentifier("status.loanNote.explorer")
        } else if let hash = note.transactionHash, !hash.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Mint transaction")
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedText)
                Text(hash)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("status.loanNote.transaction")
        }
    }
}

/// "View on block explorer ↗": the icon after the text, as in Figma 14c.
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon.accessibilityHidden(true)
        }
    }
}

#if DEBUG
#Preview("Minted, local chain") {
    let fields: [String: Any] = [
        "status": "Funded", "loanAmountEur": 210_000, "aprPct": 3.45, "termYears": 30,
        "loanNote": ["tokenId": "42", "txHash": "0x5f2c9a0e1b7d4c3a8f6e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a", "mintedAt": Date()],
    ]
    return ScrollView {
        VStack(spacing: 16) {
            LoanNoteCard(section: LoanNoteSection(record: ApplicationStatusRecord(fields: fields)!), explorerTxURL: nil)
            LoanNoteCard(section: LoanNoteSection(record: ApplicationStatusRecord(fields: fields)!),
                         explorerTxURL: "https://amoy.polygonscan.com/tx/")
            LoanNoteCard(section: .waiting)
        }
        .padding()
    }
    .background(Theme.oat)
}
#endif
