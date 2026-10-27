/// The HELOC result screen's text for one answer (Figma 07k HELOC result).
///
/// Money is formatted like the mortgage result. The screen says "estimated value", never
/// "asking price" (AL-195 criterion 5): the value is the model's estimate, not a valuation.
struct HELOCSummary: Hashable {
    let maxLine: String
    let estimatedValue: String
    let monthlyRepayment: String
    let stressedRepayment: String
    let limit: String
    /// Set only when the line is €0.
    let noEquity: String?
    let rateNote: String

    init(result: HELOCResult, termYears: Int) {
        maxLine = AffordabilitySummary.wholeEuro(result.maxLineEur)
        estimatedValue = AffordabilitySummary.wholeEuro(result.homeValueEur)
        monthlyRepayment = AffordabilitySummary.euroAndCent(result.monthlyRepaymentEur)
        stressedRepayment = AffordabilitySummary.euroAndCent(result.stressedRepaymentEur)
        limit = switch result.limitedBy {
        case .equity: "Limited by equity (80% of the estimated value, less what you owe)"
        }
        noEquity = result.hasEquity
            ? nil
            : "No equity available. You owe 80% or more of the estimated value, so there's nothing to borrow against yet."
        rateNote = "Repayments assume the full line is drawn, at the average Irish new mortgage rate, "
            + "\(AffordabilitySummary.month(result.rateDate)): \(AffordabilitySummary.percent(result.benchmarkRatePct)), "
            + "over \(termYears) years. The estimated value is the model's estimate from 2024 property listings, "
            + "not a valuation. Indicative, not an offer."
    }
}
