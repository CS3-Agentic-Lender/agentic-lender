/// Checks the affordability form: amounts are whole euro from €0, the household income is
/// above €0 and at most €10m (each income, and both together), and the term is 5 to 35 years.
/// Returns one message per field that is wrong.
enum AffordabilityValidator {
    static let maximumIncome = 10_000_000
    static let termRange = 5...35

    private static let notAnAmount = "Enter an amount of €0 or more, in whole euro"
    private static let noIncome = "Enter an income of more than €0"
    private static let incomeTooHigh = "Enter an amount up to €\(EuroAmount.format(maximumIncome))"
    private static let householdTooHigh = "Your two incomes together must be up to €\(EuroAmount.format(maximumIncome))"
    static let termOutOfRange = "Choose a term from \(termRange.lowerBound) to \(termRange.upperBound) years"

    static func errors(for form: AffordabilityForm) -> [AffordabilityField: String] {
        Dictionary(uniqueKeysWithValues: AffordabilityField.allCases.compactMap { field in
            error(for: field, in: form).map { (field, $0) }
        })
    }

    static func error(for field: AffordabilityField, in form: AffordabilityForm) -> String? {
        switch field {
        case .income:
            if let error = incomeError(form.income, whenEmpty: "Enter your gross yearly income") { return error }
            return hasHouseholdIncome(form) ? nil : noIncome
        case .secondIncome:
            guard form.applicants == .joint else { return nil }
            if let error = incomeError(form.secondIncome, whenEmpty: "Enter the second applicant's gross yearly income") {
                return error
            }
            // The API caps the household total (gross_income_eur), not each income.
            return householdIncome(form) <= maximumIncome ? nil : householdTooHigh
        case .monthlyDebts:
            return amountError(form.monthlyDebts, whenEmpty: "Enter your monthly debts, or 0 if you have none")
        case .deposit:
            return amountError(form.deposit, whenEmpty: "Enter your deposit, or 0 if you have none")
        case .term:
            return termRange.contains(form.termYears) ? nil : termOutOfRange
        }
    }

    /// The affordability endpoint needs a household income above €0; one joint applicant may earn nothing.
    private static func hasHouseholdIncome(_ form: AffordabilityForm) -> Bool {
        householdIncome(form) > 0
    }

    /// Both incomes added up. An unreadable income counts as €0, since its own error already shows.
    /// Any typed number can reach here, so a sum too large for Int comes back as Int.max instead of trapping.
    private static func householdIncome(_ form: AffordabilityForm) -> Int {
        let first = EuroAmount.parse(form.income) ?? 0
        let second = form.applicants == .joint ? EuroAmount.parse(form.secondIncome) ?? 0 : 0
        let (total, overflowed) = first.addingReportingOverflow(second)
        return overflowed ? .max : total
    }

    /// A whole-euro amount from €0. Shared with the HELOC check.
    static func amountError(_ text: String, whenEmpty: String) -> String? {
        if text.isBlank { return whenEmpty }
        return EuroAmount.parse(text) == nil ? notAnAmount : nil
    }

    /// A whole-euro income from €0 up to €10m. Shared with the HELOC check.
    static func incomeError(_ text: String, whenEmpty: String) -> String? {
        if let error = amountError(text, whenEmpty: whenEmpty) { return error }
        guard let amount = EuroAmount.parse(text), amount <= maximumIncome else { return incomeTooHigh }
        return nil
    }
}
