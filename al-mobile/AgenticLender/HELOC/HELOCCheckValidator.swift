/// Checks the HELOC check form. Amounts follow the affordability check's rules; the floor area
/// is whole m² above 0 (Nic on AL-60). Returns one message per field that is wrong.
enum HELOCCheckValidator {
    private static let floorAreaInvalid = "Enter the floor area in whole m², more than 0"

    static func errors(for form: HELOCCheckForm) -> [HELOCCheckField: String] {
        Dictionary(uniqueKeysWithValues: HELOCCheckField.allCases.compactMap { field in
            error(for: field, in: form).map { (field, $0) }
        })
    }

    static func error(for field: HELOCCheckField, in form: HELOCCheckForm) -> String? {
        switch field {
        case .county:
            return form.county == nil ? "Choose the county" : nil
        case .floorArea:
            return floorAreaError(form.floorArea)
        case .berRating:
            return form.berRating == nil ? "Choose the BER rating" : nil
        case .mortgageBalance:
            return AffordabilityValidator.amountError(
                form.mortgageBalance, whenEmpty: "Enter what's left on your mortgage, or 0 if it's paid off"
            )
        case .income:
            return AffordabilityValidator.incomeError(form.income, whenEmpty: "Enter your gross yearly income")
        case .monthlyDebts:
            return AffordabilityValidator.amountError(
                form.monthlyDebts, whenEmpty: "Enter your monthly debts, or 0 if you have none"
            )
        case .term:
            return AffordabilityValidator.termRange.contains(form.termYears) ? nil : AffordabilityValidator.termOutOfRange
        }
    }

    private static func floorAreaError(_ text: String) -> String? {
        if text.isBlank { return "Enter the floor area in m²" }
        guard let area = EuroAmount.parse(text), area > 0 else { return floorAreaInvalid }
        return nil
    }
}
