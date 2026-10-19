/// Checks the application form: take-home pay and living costs are whole euro from €0,
/// the loan amount is whole euro above €0, and the term follows the affordability rules.
/// The home needs its first address line, a valid Eircode, a county, an asking price above €0,
/// a floor area al-core accepts and a BER rating (Nic on #64: the valuation needs them).
/// A loan above the maximum is a warning, not an error, so the borrower can still go on.
enum ApplicationValidator {
    private static let notAnAmount = "Enter an amount of €0 or more, in whole euro"
    private static let loanNotAboveZero = "Enter a loan amount above €0, in whole euro"
    /// Whole m², the range al-core accepts for `floor_area_sqm`.
    static let floorAreaRange = 1...10_000

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
        case .addressLine1:
            form.property.addressLine1.isBlank ? "Enter the first line of the address" : nil
        case .eircode:
            eircodeError(form.property.eircode)
        case .county:
            form.property.county == nil ? "Choose the county" : nil
        case .askingPrice:
            askingPriceError(form.property.askingPrice)
        case .floorArea:
            floorAreaError(form.property.floorArea)
        case .berRating:
            form.property.berRating == nil ? "Choose the BER rating" : nil
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

    private static func askingPriceError(_ text: String) -> String? {
        if text.isBlank { return "Enter the asking price" }
        guard let price = EuroAmount.parse(text), price > 0 else {
            return "Enter an asking price above €0, in whole euro"
        }
        return nil
    }

    private static func floorAreaError(_ text: String) -> String? {
        if text.isBlank { return "Enter the floor area in m²" }
        guard let area = EuroAmount.parse(text), floorAreaRange.contains(area) else {
            return "Enter the floor area in whole m², from 1 to 10,000"
        }
        return nil
    }

    /// The same Eircode rule as sign-up and al-core.
    private static func eircodeError(_ text: String) -> String? {
        if text.isBlank { return "Enter the Eircode" }
        return SignUpValidator.normalizedEircode(text) == nil ? "Enter an Eircode like A65 F4E2" : nil
    }

    private static func loanError(_ text: String) -> String? {
        if text.isBlank { return "Enter the amount you want to borrow" }
        guard let loan = EuroAmount.parse(text), loan > 0 else { return loanNotAboveZero }
        return nil
    }
}
