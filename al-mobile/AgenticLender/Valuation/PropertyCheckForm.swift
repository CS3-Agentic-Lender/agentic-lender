/// What the borrower has typed into the property check (AL-143, Figma 10).
///
/// The Eircode is asked for because the model uses its routing key, the first three characters
/// (Nic's decision on AL-22, 23 Oct 2026). The asking price is optional.
struct PropertyCheckForm: Equatable {
    static let defaultBedrooms = 3

    var county: County?
    var eircode = ""
    var floorArea = ""
    var bedrooms = defaultBedrooms
    var propertyType: PropertyType?
    var berRating: BERRating?
    var askingPrice = ""
}

/// Every property check field that can show an error, in screen order.
enum PropertyCheckField: CaseIterable, Hashable {
    case county
    case eircode
    case floorArea
    case bedrooms
    case propertyType
    case berRating
    case askingPrice
}
