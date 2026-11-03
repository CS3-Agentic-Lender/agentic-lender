import Foundation

/// The parts of `applications/{id}` the status timeline needs (al-core SCHEMA.md).
///
/// Firestore fields are camelCase. Times arrive as `Date` once the Firebase layer has converted its
/// timestamps; `decision.decidedAt` may also be ISO 8601 text.
struct ApplicationStatusRecord: Equatable, Sendable {
    /// One entry of `statusHistory`: the status reached and when.
    struct Move: Equatable, Sendable {
        let to: ApplicationStatus
        let at: Date
    }

    struct Decision: Equatable, Sendable {
        enum Outcome: String, Sendable {
            case approved
            case declined
        }

        let outcome: Outcome
        let decidedAt: Date?
        /// Why it was declined, when the underwriter gave a reason.
        let reason: String?
    }

    let status: ApplicationStatus
    let createdAt: Date?
    let submittedAt: Date?
    let decision: Decision?
    /// Oldest first. Empty for applications moved before `statusHistory` existed, such as the seed.
    let history: [Move]
    /// LTV, DTI and approval likelihood, once the AI review has written them (AL-145).
    let figures: LoanFigures
    /// Set by the mint, in the same write that moves the status to Funded (Figma 14c).
    let loanNote: LoanNote?

    init(
        status: ApplicationStatus, createdAt: Date?, submittedAt: Date?, decision: Decision?, history: [Move],
        figures: LoanFigures = LoanFigures(fields: [:]), loanNote: LoanNote? = nil
    ) {
        self.status = status
        self.createdAt = createdAt
        self.submittedAt = submittedAt
        self.decision = decision
        self.history = history
        self.figures = figures
        self.loanNote = loanNote
    }

    /// Nil when the document has no status the app knows, since nothing sensible can be shown then.
    init?(fields: [String: Any]) {
        guard let status = (fields["status"] as? String).flatMap(ApplicationStatus.init(rawValue:)) else { return nil }
        self.init(
            status: status,
            createdAt: Self.date(fields["createdAt"]),
            submittedAt: Self.date(fields["submittedAt"]),
            decision: (fields["decision"] as? [String: Any]).flatMap(Self.decision),
            history: (fields["statusHistory"] as? [Any] ?? []).compactMap(Self.move),
            figures: LoanFigures(fields: fields),
            loanNote: LoanNote(fields: fields)
        )
    }

    private static func decision(_ map: [String: Any]) -> Decision? {
        guard let outcome = (map["outcome"] as? String).flatMap(Decision.Outcome.init(rawValue:)) else { return nil }
        let reason = (map["reason"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return Decision(outcome: outcome, decidedAt: date(map["decidedAt"]), reason: reason?.isEmpty == false ? reason : nil)
    }

    private static func move(_ entry: Any) -> Move? {
        guard let map = entry as? [String: Any],
              let to = (map["to"] as? String).flatMap(ApplicationStatus.init(rawValue:)),
              let at = date(map["at"])
        else { return nil }
        return Move(to: to, at: at)
    }

    private static func date(_ value: Any?) -> Date? {
        if let date = value as? Date { return date }
        guard let text = value as? String else { return nil }
        return isoWithFractions.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }

    private static let isoWithFractions: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
