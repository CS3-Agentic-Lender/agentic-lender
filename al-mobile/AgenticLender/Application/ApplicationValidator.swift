/// Checks the application form: take-home pay and living costs are whole euro from €0,
/// the loan amount is whole euro above €0, and the term follows the affordability rules.
/// A loan above the maximum is a warning, not an error, so the borrower can still go on.
enum ApplicationValidator {
    private static let notAnAmount = "Enter an amount of €0 or more, in whole euro"
    private static let loanNotAboveZero = "Enter a loan amount above €0, in whole euro"

    static func errors(for form: ApplicationForm) -> [ApplicationField: String] {
        Dictionary(uniqueKeysWithValues: ApplicationField.allCases.compactMap { field in
            error(for: field, in: form).map { (field, $0) }
        })
    }

    static func error(for field: ApplicationField, in form: ApplicationForm) -> String? {
        switch field {
        case .monthlyTakeHome:
            amountError(form.monthlyTakeHome, whenEmpty: "Enter your monthly take-home pay")
        case .monthlyLivingCosts:
            amountError(form.monthlyLivingCosts, whenEmpty: "Enter your monthly living costs")
        case .loanAmount:
            loanError(form.loanAmount)
        }
    }

    /// Figma 12a: shown while a valid loan amount is above the affordability maximum.
    static func loanWarning(for form: ApplicationForm) -> String? {
        guard let loan = EuroAmount.parse(form.loanAmount), Double(loan) > form.maxLoanEur.rounded() else { return nil }
        let maximum = EuroAmount.format(Int(form.maxLoanEur.rounded()))
        return "This is above the €\(maximum) you could borrow. Your broker may ask you to lower it."
    }

    private static func amountError(_ text: String, whenEmpty: String) -> String? {
        if text.isBlank { return whenEmpty }
        return EuroAmount.parse(text) == nil ? notAnAmount : nil
    }

    private static func loanError(_ text: String) -> String? {
        if text.isBlank { return "Enter the amount you want to borrow" }
        guard let loan = EuroAmount.parse(text), loan > 0 else { return loanNotAboveZero }
        return nil
    }
}
