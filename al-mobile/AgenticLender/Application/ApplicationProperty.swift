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

extension ApplicationProperty {
    /// This property with a saved check's details filled in (AL-144). The address lines stay as typed,
    /// since a saved check has none, and so does a typed asking price when the check had none.
    func filled(from check: SavedCheck) -> ApplicationProperty {
        var filled = self
        filled.eircode = check.eircode
        filled.county = check.county
        filled.propertyType = check.propertyType
        filled.bedrooms = check.bedrooms
        filled.floorArea = EuroAmount.format(check.floorAreaM2)
        filled.berRating = check.berRating
        if let askingPrice = check.askingPriceEur {
            filled.askingPrice = EuroAmount.format(askingPrice)
        }
        return filled
    }
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

    /// An empty second line goes as `null`, not left out: al-core ignores it on a new Draft,
    /// and on an edit it clears a line the borrower has removed (PATCH changes only what it's sent).
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(addressLine1, forKey: .addressLine1)
        try container.encode(addressLine2, forKey: .addressLine2)
        try container.encode(eircode, forKey: .eircode)
        try container.encode(county, forKey: .county)
        try container.encode(askingPriceEur, forKey: .askingPriceEur)
        try container.encode(propertyType, forKey: .propertyType)
        try container.encode(bedrooms, forKey: .bedrooms)
        try container.encode(floorAreaSqm, forKey: .floorAreaSqm)
        try container.encode(berRating, forKey: .berRating)
    }
}
