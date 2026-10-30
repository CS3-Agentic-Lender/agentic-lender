import Foundation

/// The borrower's newest application, as the card on Home shows it (AL-104, Figma Home and 14f):
/// a short status badge, the amount and term, and one line on what happens next.
struct HomeApplication: Equatable {
    let id: String
    let status: ApplicationStatus
    let loanType: LoanType
    let loanAmountEur: Int?
    let termYears: Int?
    let createdAt: Date?

    /// From Firestore fields with timestamps already converted to `Date`. Nil for a status the app
    /// doesn't know, since the card couldn't say anything true about it.
    init?(id: String, fields: [String: Any]) {
        guard let status = (fields["status"] as? String).flatMap(ApplicationStatus.init(rawValue:)) else { return nil }
        self.id = id
        self.status = status
        loanType = (fields["loanType"] as? String).flatMap(LoanType.init(rawValue:)) ?? .mortgage
        loanAmountEur = (fields["loanAmountEur"] as? NSNumber).map { Int($0.doubleValue.rounded()) }
        termYears = (fields["termYears"] as? NSNumber)?.intValue
        createdAt = fields["createdAt"] as? Date
    }

    /// The one Home shows: the most recently created. One without a time counts as oldest.
    static func newest(of applications: [HomeApplication]) -> HomeApplication? {
        applications.max { ($0.createdAt ?? .distantPast) < ($1.createdAt ?? .distantPast) }
    }

    /// A short label in the status's palette A tone, like the portal's ("AI review" in Figma Home).
    var badge: StatusTimeline.Badge {
        let text = switch status {
        case .draft: "Draft"
        case .applied: "Submitted"
        case .aiDeliberated: "AI review"
        case .underwriterApproved: "Approved"
        case .declined: "Declined"
        case .funded: "Funded"
        case .closed: "Closed"
        }
        return StatusTimeline.Badge(text: text, tone: status.tone)
    }

    /// "€210,000 · 30 years", or "€90,000 credit line · 20 years" for a HELOC. Nil until a Draft has both.
    var terms: String? {
        guard let loanAmountEur, let termYears else { return nil }
        let amount = "€\(EuroAmount.format(loanAmountEur))"
        return "\(loanType == .heloc ? "\(amount) credit line" : amount) · \(termYears) years"
    }

    /// What happens next, in one line.
    var detail: String {
        switch status {
        case .draft: "Saved as a draft. It isn't submitted yet."
        case .applied: "The AI credit committee is reviewing it."
        case .aiDeliberated: "The AI credit committee has reviewed it. The underwriter decides next."
        case .underwriterApproved: "Approved. Your loan note is minted next."
        case .declined: "Declined. View status for the reason."
        case .funded: "Your loan note has been minted."
        case .closed: "This application is closed."
        }
    }
}
