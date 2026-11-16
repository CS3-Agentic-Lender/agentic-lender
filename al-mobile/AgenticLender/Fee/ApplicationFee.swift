import Foundation

/// The fast-track appraisal fee as al-core's Stripe webhook records it on the application (AL-148).
/// The app never marks the fee paid itself: it only reads what the webhook wrote.
///
/// Field names follow the agreed contract (`feeStatus`, `feeIntentId`); `feePaidAt` is the time the
/// webhook marked it paid. All three are read here and nowhere else, so a rename touches this file only.
struct ApplicationFee: Equatable, Sendable {
    /// What the status screen shows about the fee (Figma 16a and 18a).
    enum Section: Equatable {
        /// "Speed up your valuation · €150 · See details".
        case offer
        /// "Fast-track paid · 29 Sep · View receipt".
        case paid(Date?)
    }

    static let amountEur = 150

    let isPaid: Bool
    let paidAt: Date?
    let paymentIntentID: String?

    init(fields: [String: Any]) {
        isPaid = (fields["feeStatus"] as? String) == "paid"
        paidAt = fields["feePaidAt"] as? Date
        paymentIntentID = fields["feeIntentId"] as? String
    }

    /// The offer shows once the application is submitted and until the underwriter decides; a paid
    /// fee stays on the screen from then on.
    func section(for status: ApplicationStatus) -> Section? {
        if isPaid { return .paid(paidAt) }
        switch status {
        case .applied, .aiDeliberated: return .offer
        case .draft, .underwriterApproved, .declined, .funded, .closed: return nil
        }
    }
}
