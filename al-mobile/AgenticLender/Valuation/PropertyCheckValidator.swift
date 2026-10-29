/// Checks the property check form. The limits are the application's (al-core), so every check can be
/// saved and can fill an application. Inside them, a size the model wasn't trained on still gets an
/// estimate, with a warning from the endpoint. Returns one message per field that is wrong.
enum PropertyCheckValidator {
    static let floorAreaRange = 1...10_000
    static let bedroomsRange = ApplicationProperty.bedroomsRange
    static let askingPriceRange = 1...100_000_000

    private static let floorAreaInvalid =
        "Enter a size in whole m², from \(floorAreaRange.lowerBound) to \(EuroAmount.format(floorAreaRange.upperBound))"
    private static let bedroomsInvalid = "Choose from \(bedroomsRange.lowerBound) to \(bedroomsRange.upperBound) bedrooms"
    private static let askingPriceInvalid =
        "Enter an asking price in whole euro, from €\(EuroAmount.format(askingPriceRange.lowerBound)) to €\(EuroAmount.format(askingPriceRange.upperBound))"

    static func errors(for form: PropertyCheckForm) -> [PropertyCheckField: String] {
        Dictionary(uniqueKeysWithValues: PropertyCheckField.allCases.compactMap { field in
            error(for: field, in: form).map { (field, $0) }
        })
    }

    static func error(for field: PropertyCheckField, in form: PropertyCheckForm) -> String? {
        switch field {
        case .county:
            return form.county == nil ? "Choose a county" : nil
        case .eircode:
            if form.eircode.isBlank { return "Enter the Eircode" }
            return SignUpValidator.normalizedEircode(form.eircode) == nil ? "Enter an Eircode like A65 F4E2" : nil
        case .floorArea:
            if form.floorArea.isBlank { return "Enter the size in m²" }
            return wholeNumber(form.floorArea, in: floorAreaRange) == nil ? floorAreaInvalid : nil
        case .bedrooms:
            return bedroomsRange.contains(form.bedrooms) ? nil : bedroomsInvalid
        case .propertyType:
            return form.propertyType == nil ? "Choose a property type" : nil
        case .berRating:
            return form.berRating == nil ? "Choose a BER rating" : nil
        case .askingPrice:
            if form.askingPrice.isBlank { return nil }
            return wholeNumber(form.askingPrice, in: askingPriceRange) == nil ? askingPriceInvalid : nil
        }
    }

    /// The typed number, if it is a whole number in the range (thousands separators allowed).
    static func wholeNumber(_ text: String, in range: ClosedRange<Int>) -> Int? {
        guard let number = EuroAmount.parse(text), range.contains(number) else { return nil }
        return number
    }
}
