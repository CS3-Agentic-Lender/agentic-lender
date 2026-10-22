/// The home the borrower wants to buy, as typed into the application form's property step.
struct ApplicationProperty: Equatable {
    /// The bedroom counts al-core accepts.
    static let bedroomsRange = 0...20

    var addressLine1 = ""
    var addressLine2 = ""
    var eircode = ""
    var county: County?
    var askingPrice = ""
    var propertyType: PropertyType?
    /// Empty until the borrower picks a count, so nobody submits a number they never chose (Nic on #61).
    var bedrooms: Int?
    var floorArea = ""
    var berRating: BERRating?
}

/// A checked property in the API field names of `POST /core/applications`: whole euro and m²,
/// the Eircode in capitals with a space, and no second address line when it was left empty.
struct PropertyDraft: Encodable, Equatable {
    let addressLine1: String
    let addressLine2: String?
    let eircode: String
    let county: String
    let askingPriceEur: Int
    let propertyType: String
    let bedrooms: Int
    let floorAreaSqm: Int
    let berRating: String

    /// Nil when any property field is missing or wrong; the validator says which.
    init?(property: ApplicationProperty) {
        guard let eircode = SignUpValidator.normalizedEircode(property.eircode),
              let county = property.county,
              let propertyType = property.propertyType,
              let bedrooms = property.bedrooms,
              let berRating = property.berRating,
              let askingPrice = EuroAmount.parse(property.askingPrice),
              let floorArea = EuroAmount.parse(property.floorArea),
              !property.addressLine1.isBlank
        else { return nil }

        addressLine1 = property.addressLine1.trimmed
        addressLine2 = property.addressLine2.isBlank ? nil : property.addressLine2.trimmed
        self.eircode = eircode
        self.county = county.rawValue
        askingPriceEur = askingPrice
        self.propertyType = propertyType.rawValue
        self.bedrooms = bedrooms
        floorAreaSqm = floorArea
        self.berRating = berRating.rawValue
    }

    private enum CodingKeys: String, CodingKey {
        case addressLine1 = "address_line_1"
        case addressLine2 = "address_line_2"
        case eircode
        case county
        case askingPriceEur = "asking_price_eur"
        case propertyType = "property_type"
        case bedrooms
        case floorAreaSqm = "floor_area_sqm"
        case berRating = "ber_rating"
    }
}
