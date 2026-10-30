import Foundation

/// Approval likelihood as al-core stores it on the application: a label from a fixed rule order on
/// the backend, never a percentage, and indicative only.
enum ApprovalLikelihood: String, CaseIterable, Equatable, Sendable {
    case high = "High"
    case medium = "Medium"
    case low = "Low"
    case unknown = "Unknown"

    var label: String { rawValue }

    /// Palette A, like the status badges.
    var tone: StatusTone {
        switch self {
        case .high: .success
        case .medium: .tint
        case .low: .danger
        case .unknown: .neutral
        }
    }
}

/// The three tiles under the reference on the status screen (AL-145, Figma 14) and the
/// "What do these mean?" sheet (Figma 14e). The figures are the backend's; the app only words them.
struct LoanFigures: Equatable, Sendable {
    struct Tile: Equatable {
        let title: String
        let value: String
        let note: String
    }

    struct Explanation: Equatable {
        let title: String
        let value: String?
        let text: String
    }

    static let likelihoodNote = "indicative"
    /// The Central Bank limit for a purchase, and the prototype's HELOC policy (docs/infrastructure.md).
    static let purchaseLtvLimitPct = 90
    static let helocLtvLimitPct = 80

    let loanType: LoanType
    /// Purchase-price LTV for a purchase, combined LTV for a HELOC (agreed on the backend ticket).
    let ltvPct: Double?
    let dtiPct: Double?
    /// Unknown until al-ai has run, as agreed.
    let likelihood: ApprovalLikelihood

    /// From the application's fields: `purchaseLtvPct` for a purchase, `ltvPct` for a HELOC,
    /// `dtiPct`, and the `approvalLikelihood` label. Anything missing shows as not there yet.
    init(fields: [String: Any]) {
        loanType = (fields["loanType"] as? String).flatMap(LoanType.init(rawValue:)) ?? .mortgage
        ltvPct = Self.number(fields[loanType == .heloc ? "ltvPct" : "purchaseLtvPct"])
        dtiPct = Self.number(fields["dtiPct"])
        likelihood = (fields["approvalLikelihood"] as? String).flatMap(ApprovalLikelihood.init(rawValue:)) ?? .unknown
    }

    private var ltvLimitPct: Int { loanType == .heloc ? Self.helocLtvLimitPct : Self.purchaseLtvLimitPct }

    var ltv: Tile {
        Tile(
            title: loanType == .heloc ? "Combined LTV" : "LTV",
            value: Self.percent(ltvPct, limit: Double(ltvLimitPct)),
            note: "limit \(ltvLimitPct)%"
        )
    }

    var dti: Tile { Tile(title: "DTI", value: Self.percent(dtiPct), note: "of income") }

    /// Figma 14e, one line each.
    var explanations: [Explanation] {
        [
            Explanation(
                title: ltv.title, value: ltvPct.map { _ in ltv.value },
                text: loanType == .heloc
                    ? "What you still owe plus the credit line, as a share of your home's estimated value. Up to \(Self.helocLtvLimitPct)%."
                    : "Your loan as a share of the property price. Buyers can borrow up to \(Self.purchaseLtvLimitPct)% of the price."
            ),
            Explanation(
                title: "DTI", value: dtiPct.map { _ in dti.value },
                text: "Your monthly debts, including this loan, as a share of your monthly income before tax."
            ),
            Explanation(
                title: "Approval likelihood", value: nil,
                text: "Indicative: High, Medium, Low or Unknown, worked out from your application's figures. It isn't a decision. Unknown means some details are missing."
            ),
        ]
    }

    private static let locale = Locale(identifier: "en_IE")

    /// "87.6%", to one decimal, rounded away from its limit so a figure never reads as at the limit
    /// when it isn't: 89.96 is "89.9%" and 90.04 is "90.1%" against 90. "—" before the AI review.
    private static func percent(_ value: Double?, limit: Double = .infinity) -> String {
        guard let value else { return "—" }
        let rule: FloatingPointRoundingRule = value > limit ? .up : .down
        return value.formatted(.number.precision(.fractionLength(1)).rounded(rule: rule).locale(locale)) + "%"
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }
}
