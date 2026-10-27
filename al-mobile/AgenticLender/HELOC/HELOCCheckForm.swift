/// What the homeowner has typed into the HELOC check (AL-207, Figma 07i and 07j).
///
/// There is no field for the home's value: the valuation model works it out from the house details.
struct HELOCCheckForm: Equatable {
    static let defaultBedrooms = 3
    static let defaultTermYears = 20

    var county: County?
    var propertyType: PropertyType?
    var floorArea = ""
    var bedrooms = defaultBedrooms
    var berRating: BERRating?
    var mortgageBalance = ""
    var income = ""
    var monthlyDebts = ""
    var termYears = defaultTermYears
}

/// Every HELOC check field that can show an error. Bedrooms can't be wrong: the stepper stops at 0.
enum HELOCCheckField: CaseIterable, Hashable {
    case county
    case propertyType
    case floorArea
    case berRating
    case mortgageBalance
    case income
    case monthlyDebts
    case term
}
