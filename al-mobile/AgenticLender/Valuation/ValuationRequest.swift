import Foundation

/// A checked property check, ready to send to `POST /ai/valuation` (contract in docs/api-design.md).
///
/// The full Eircode is sent and al-ai works out the routing key. No name or address goes with it.
struct ValuationRequest: Hashable {
    let county: County
    /// Capitals with one space, e.g. "T12 X8Y2", the format the endpoint checks.
    let eircode: String
    let floorAreaM2: Int
    let bedrooms: Int
    let propertyType: PropertyType
    let berRating: BERRating
    let askingPriceEur: Int?

    /// Nil while the form still has an error, so nothing invalid is ever sent.
    init?(form: PropertyCheckForm) {
        guard PropertyCheckValidator.errors(for: form).isEmpty,
              let county = form.county,
              let eircode = SignUpValidator.normalizedEircode(form.eircode),
              let floorArea = EuroAmount.parse(form.floorArea),
              let propertyType = form.propertyType,
              let berRating = form.berRating
        else { return nil }

        self.county = county
        self.eircode = eircode
        floorAreaM2 = floorArea
        bedrooms = form.bedrooms
        self.propertyType = propertyType
        self.berRating = berRating
        askingPriceEur = form.askingPrice.isBlank ? nil : EuroAmount.parse(form.askingPrice)
    }

    /// The JSON body. A missing asking price is left out, since the endpoint forbids unknown fields
    /// and reads "not sent" as "nothing to compare".
    func body() throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return try encoder.encode(Body(
            county: county.rawValue,
            eircode: eircode,
            floorAreaM2: floorAreaM2,
            bedrooms: bedrooms,
            propertyType: propertyType.rawValue,
            ber: berRating.rawValue,
            askingPriceEur: askingPriceEur
        ))
    }

    /// `encodeIfPresent` (the default for optionals) leaves out a nil asking price.
    private struct Body: Encodable {
        let county: String
        let eircode: String
        let floorAreaM2: Int
        let bedrooms: Int
        let propertyType: String
        let ber: String
        let askingPriceEur: Int?
    }
}
