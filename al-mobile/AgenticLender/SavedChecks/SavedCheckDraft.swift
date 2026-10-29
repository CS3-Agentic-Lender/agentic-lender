import Foundation

/// The body of `POST /core/saved-checks`: the check that was run and the answer it got. al-core stores it
/// as sent and doesn't value the home again. The property uses the application's names, so a saved check
/// can fill an application with no renaming.
struct SavedCheckDraft: Encodable, Equatable {
    struct Property: Encodable, Equatable {
        let county: String
        let eircode: String
        let propertyType: String
        let bedrooms: Int
        let floorAreaSqm: Int
        let berRating: String
        let askingPriceEur: Int?
    }

    let property: Property
    let estimatedValueEur: Double
    let askingPriceGap: Double?
    let priceNeedsReview: Bool?
    let supportWarnings: [String]
    let modelVersion: String

    /// With no asking price there is nothing to compare, so the gap and the flag are left out: al-core
    /// refuses them on their own.
    init(request: ValuationRequest, result: ValuationResult) {
        let hasAskingPrice = request.askingPriceEur != nil
        property = Property(
            county: request.county.rawValue,
            eircode: request.eircode,
            propertyType: request.propertyType.rawValue,
            bedrooms: request.bedrooms,
            floorAreaSqm: request.floorAreaM2,
            berRating: request.berRating.rawValue,
            askingPriceEur: request.askingPriceEur
        )
        estimatedValueEur = result.estimateEur
        askingPriceGap = hasAskingPrice ? result.askingPriceGap : nil
        priceNeedsReview = hasAskingPrice ? result.priceNeedsReview : nil
        supportWarnings = result.supportWarnings
        modelVersion = result.modelVersion
    }

    /// The JSON body in snake_case. A nil field is left out, not sent as null.
    func body() throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return try encoder.encode(self)
    }
}
