/// Checks the affordability form: amounts are whole euro from €0, each income is at most
/// €10m, and the term is 5 to 35 years. Returns one message per field that is wrong.
enum AffordabilityValidator {
    static let maximumIncome = 10_000_000
    static let termRange = 5...35

    private static let notAnAmount = "Enter an amount of €0 or more, in whole euro"
    private static let incomeTooHigh = "Enter an amount up to €\(EuroAmount.format(maximumIncome))"

    static func errors(for form: AffordabilityForm) -> [AffordabilityField: String] {
        Dictionary(uniqueKeysWithValues: AffordabilityField.allCases.compactMap { field in
            error(for: field, in: form).map { (field, $0) }
        })
    }

    static func error(for field: AffordabilityField, in form: AffordabilityForm) -> String? {
        switch field {
        case .income:
            return incomeError(form.income, whenEmpty: "Enter your gross yearly income")
        case .secondIncome:
            guard form.applicants == .joint else { return nil }
            return incomeError(form.secondIncome, whenEmpty: "Enter the second applicant's gross yearly income")
        case .monthlyDebts:
            return amountError(form.monthlyDebts, whenEmpty: "Enter your monthly debts, or 0 if you have none")
        case .deposit:
            return amountError(form.deposit, whenEmpty: "Enter your deposit, or 0 if you have none")
        case .term:
            return termRange.contains(form.termYears) ? nil : "Choose a term from 5 to 35 years"
        }
    }

    private static func amountError(_ text: String, whenEmpty: String) -> String? {
        if text.isBlank { return whenEmpty }
        return EuroAmount.parse(text) == nil ? notAnAmount : nil
    }

    private static func incomeError(_ text: String, whenEmpty: String) -> String? {
        if let error = amountError(text, whenEmpty: whenEmpty) { return error }
        guard let amount = EuroAmount.parse(text), amount <= maximumIncome else { return incomeTooHigh }
        return nil
    }
}
