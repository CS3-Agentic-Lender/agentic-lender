import Foundation

/// The result screen's text for one affordability result (Figma "Affordability result" and 08a).
///
/// The loan and price are shown to the euro and repayments to the cent, as AL-97's test cases require.
struct AffordabilitySummary: Hashable {
    let maxLoan: String
    let maxPropertyPrice: String
    let monthlyRepayment: String
    let stressedRepayment: String
    let limit: String
    let rateNote: String
    /// Set only when the maximum loan shows as €0 (AL-237): why, and what would change it.
    let cantBorrow: CantBorrow?

    struct CantBorrow: Hashable {
        let title: String
        let reason: String
        let whatWouldChange: String
    }

    private static let locale = Locale(identifier: "en_IE")

    init(result: AffordabilityResult, termYears: Int, isFirstTimeBuyer: Bool) {
        maxLoan = Self.wholeEuro(result.maxLoanEur)
        maxPropertyPrice = Self.wholeEuro(result.maxPropertyPriceEur)
        monthlyRepayment = Self.euroAndCent(result.monthlyRepaymentEur)
        stressedRepayment = Self.euroAndCent(result.stressedRepaymentEur)
        limit = Self.limitText(result.limitedBy, isFirstTimeBuyer: isFirstTimeBuyer)
        cantBorrow = result.maxLoanEur.rounded() <= 0
            ? Self.cantBorrow(result.limitedBy, isFirstTimeBuyer: isFirstTimeBuyer)
            : nil
        rateNote = "Repayments use the average Irish new mortgage rate, \(Self.month(result.rateDate)): "
            + "\(Self.percent(result.benchmarkRatePct)), over \(termYears) years. Indicative, not an offer."
    }

    private static func limitText(_ limit: AffordabilityResult.Limit, isFirstTimeBuyer: Bool) -> String {
        switch limit {
        case .income: "Limited by income (\(isFirstTimeBuyer ? "4" : "3.5")× income)"
        case .deposit: "Limited by deposit (90% LTV)"
        case .debts: "Limited by debts (40% of income)"
        }
    }

    private static func cantBorrow(_ limit: AffordabilityResult.Limit, isFirstTimeBuyer: Bool) -> CantBorrow {
        let (reason, whatWouldChange) = switch limit {
        case .debts: (
            "Your monthly debts already use up the 40% of income that can go on repayments, so there's nothing left for a mortgage.",
            "Paying down your debts, or a higher income, would change this."
        )
        case .deposit: (
            "A mortgage needs a deposit of at least 10% of the price (90% LTV), so with no deposit there's nothing to lend.",
            "Saving a deposit would change this."
        )
        case .income: (
            "Lenders can lend up to \(isFirstTimeBuyer ? "4" : "3.5")× your income, and this income doesn't allow a loan.",
            "A higher income would change this."
        )
        }
        return CantBorrow(title: "You can't borrow yet", reason: reason, whatWouldChange: whatWouldChange)
    }

    static func wholeEuro(_ amount: Double) -> String {
        amount.formatted(.currency(code: "EUR").precision(.fractionLength(0)).rounded(rule: .toNearestOrAwayFromZero).locale(locale))
    }

    static func euroAndCent(_ amount: Double) -> String {
        amount.formatted(.currency(code: "EUR").precision(.fractionLength(2)).locale(locale))
    }

    /// 4.0 → "4.0%", 3.87 → "3.87%".
    static func percent(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1...2)).locale(locale)) + "%"
    }

    /// "2026-08" → "Aug 2026"; anything else is shown as sent.
    static func month(_ rateDate: String) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM"
        guard let date = parser.date(from: rateDate) else { return rateDate }
        let display = DateFormatter()
        display.locale = locale
        display.timeZone = parser.timeZone
        display.dateFormat = "MMM yyyy"
        return display.string(from: date)
    }
}

/// A calculation the result screen can show, with the answers it came from for the application form.
struct AffordabilityOutcome: Hashable {
    let request: AffordabilityRequest
    let result: AffordabilityResult
    let summary: AffordabilitySummary
    /// Chosen before the check started; the application keeps it.
    let loanType: LoanType

    /// Nothing to apply for when the maximum loan is €0 (AL-237).
    var canApply: Bool { summary.cantBorrow == nil }

    /// "Start application": the form begins from these answers, this maximum and this loan type.
    func applicationForm() -> ApplicationForm {
        ApplicationForm(affordability: request, maxLoanEur: result.maxLoanEur, loanType: loanType)
    }
}
