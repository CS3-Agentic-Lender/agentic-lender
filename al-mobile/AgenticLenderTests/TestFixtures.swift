@testable import AgenticLender

/// Values shared by the unit tests. Every password here is fake and used only in unit tests.
enum TestFixtures {
    static let password = "secret12" // betterleaks:allow — fake password, unit tests only, never real auth
    static let lettersOnlyPassword = "abcdefgh" // betterleaks:allow — fake weak password for rule tests
    static let numbersOnlyPassword = "12345678" // betterleaks:allow — fake weak password for rule tests
    static let eightCharacterPassword = "abcdefg1" // betterleaks:allow — fake password at the minimum length

    /// A valid single, first-time buyer form with no debts over the default 30 years.
    static func affordabilityForm(income: String, deposit: String) -> AffordabilityForm {
        var form = AffordabilityForm()
        form.income = income
        form.monthlyDebts = "0"
        form.deposit = deposit
        return form
    }

    /// An application form started from reference case 1 (maximum loan €240,000).
    static func applicationForm() -> ApplicationForm {
        ApplicationForm(
            affordability: AffordabilityRequest(form: affordabilityForm(income: "60,000", deposit: "40,000"))!,
            maxLoanEur: 240_000
        )
    }

    /// Reference case 2: joint, not first-time buyers, €50,000 + €40,000 income, €30,000 deposit, 25 years.
    static func jointAffordabilityRequest() -> AffordabilityRequest {
        var form = affordabilityForm(income: "50,000", deposit: "30,000")
        form.applicants = .joint
        form.secondIncome = "40,000"
        form.isFirstTimeBuyer = false
        form.termYears = 25
        return AffordabilityRequest(form: form)!
    }

    /// Reference case 1's response from the affordability endpoint, with the limit swapped.
    static func affordabilityJSON(limitedBy: String = "income") -> String {
        """
        {"max_loan_eur": 240000, "max_property_price_eur": 280000, "monthly_repayment_eur": 1145.80,
         "stressed_repayment_eur": 1438.92, "limited_by": "\(limitedBy)", "benchmark_rate_pct": 4.0,
         "stressed_rate_pct": 6.0, "rate_date": "2026-08"}
        """
    }
}
