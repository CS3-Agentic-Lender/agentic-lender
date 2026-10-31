import Foundation

/// The loan note on the status screen (Figma 14c): what al-core's mint endpoint saved on the
/// application when it minted the ERC-721 note and moved the status to Funded (al-core SCHEMA.md).
///
/// `loanNote` holds `tokenId` (text), `txHash` (the mint transaction) and `mintedAt`. The terms the
/// note was minted with are the application's own: `loanAmountEur`, `termYears` and `aprPct`. The
/// borrower can't read `review/underwriting`, so a rate stored only there shows as "—".
struct LoanNote: Equatable, Sendable {
    struct Row: Equatable, Sendable {
        let title: String
        let value: String
    }

    let tokenID: String
    /// Nil only if al-core ever saved a note without one; the screen then has nothing to link.
    let transactionHash: String?
    let mintedAt: Date?
    let principalEur: Int?
    let aprPct: Double?
    let termYears: Int?

    /// What a missing figure reads as.
    static let missing = "—"

    /// Nil when the application has no loan note yet, or one with no token ID.
    init?(fields: [String: Any]) {
        guard let note = fields["loanNote"] as? [String: Any],
              let tokenID = (note["tokenId"] as? String)?.trimmed, !tokenID.isEmpty
        else { return nil }
        self.tokenID = tokenID
        transactionHash = (note["txHash"] as? String)?.trimmed
        mintedAt = Self.date(note["mintedAt"])
        principalEur = (fields["loanAmountEur"] as? NSNumber).map { Int($0.doubleValue.rounded()) }
        termYears = (fields["termYears"] as? NSNumber)?.intValue
        aprPct = (fields["aprPct"] as? NSNumber)?.doubleValue
    }

    /// Token ID, Principal, APR, Term and Mint date, in Figma 14c's order.
    func rows(timeZone: TimeZone = .current) -> [Row] {
        [
            Row(title: "Token ID", value: "#\(tokenID)"),
            Row(title: "Principal", value: principalEur.map { "€\(EuroAmount.format($0))" } ?? Self.missing),
            Row(title: "APR", value: aprPct.map(Self.rate) ?? Self.missing),
            Row(title: "Term", value: termYears.map { $0 == 1 ? "1 year" : "\($0) years" } ?? Self.missing),
            Row(title: "Mint date", value: mintedAt.map { Self.dateText($0, timeZone: timeZone) } ?? Self.missing),
        ]
    }

    /// The mint transaction on the block explorer, when one is set (`BackendConfig.blockExplorerTxURL`).
    /// The local Hardhat chain has no explorer, so the screen shows the hash instead.
    func explorerURL(transactionBase: String?) -> URL? {
        guard let transactionBase, let transactionHash, !transactionHash.isEmpty else { return nil }
        return URL(string: transactionBase + transactionHash)
    }

    /// "3.45%", and at least one decimal: "4.0%".
    private static func rate(_ pct: Double) -> String {
        "\(pct.formatted(.number.precision(.fractionLength(1...2)).locale(Locale(identifier: "en_IE"))))%"
    }

    /// "3 Oct 2026". POSIX so the month is English whatever the phone's language, like the timeline.
    private static func dateText(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }

    /// A Firestore timestamp arrives as `Date`; al-core's API writes ISO 8601 text.
    private static func date(_ value: Any?) -> Date? {
        if let date = value as? Date { return date }
        guard let text = value as? String else { return nil }
        let withFractions = ISO8601DateFormatter()
        withFractions.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFractions.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}

/// What the status screen shows under the timeline.
enum LoanNoteSection: Equatable, Sendable {
    /// A Draft hasn't been submitted, and a declined or closed application without a note never gets one.
    case hidden
    /// Submitted, not minted yet.
    case waiting
    case minted(LoanNote)

    static let waitingText = "Your loan note will appear here once the bank approves and funds your loan"

    init(record: ApplicationStatusRecord) {
        if let note = record.loanNote {
            self = .minted(note)
            return
        }
        switch record.status {
        case .draft, .declined, .closed: self = .hidden
        case .applied, .aiDeliberated, .underwriterApproved, .funded: self = .waiting
        }
    }
}
