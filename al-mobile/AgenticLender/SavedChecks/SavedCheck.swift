import Foundation

/// One saved property check, as stored in `users/{uid}/saved_checks/{id}` (al-core SCHEMA.md), and
/// the row the Properties list (Figma 09) and the application form show for it (AL-144).
struct SavedCheck: Equatable, Identifiable {
    let id: String
    let county: County
    /// Capitals with one space, as al-core checked it.
    let eircode: String
    let propertyType: PropertyType
    let bedrooms: Int
    let floorAreaM2: Int
    let berRating: BERRating
    let askingPriceEur: Int?
    let estimateEur: Double
    let priceNeedsReview: Bool?
    let createdAt: Date?

    /// From Firestore fields with timestamps already converted to `Date`. Nil when a field the app needs
    /// is missing or one it doesn't know, since such a check can't be shown or fill an application.
    init?(id: String, fields: [String: Any]) {
        guard let property = fields["property"] as? [String: Any],
              let county = (property["county"] as? String).flatMap(County.init(rawValue:)),
              let eircode = (property["eircode"] as? String).flatMap(SignUpValidator.normalizedEircode),
              let propertyType = (property["propertyType"] as? String).flatMap(PropertyType.init(rawValue:)),
              let bedrooms = Self.whole(property["bedrooms"]),
              let floorArea = Self.whole(property["floorAreaSqm"]),
              let berRating = (property["berRating"] as? String).flatMap(BERRating.init(rawValue:)),
              let estimate = Self.number(fields["estimatedValueEur"])
        else { return nil }

        self.id = id
        self.county = county
        self.eircode = eircode
        self.propertyType = propertyType
        self.bedrooms = bedrooms
        floorAreaM2 = floorArea
        self.berRating = berRating
        askingPriceEur = Self.whole(property["askingPriceEur"])
        estimateEur = estimate
        priceNeedsReview = fields["priceNeedsReview"] as? Bool
        createdAt = fields["createdAt"] as? Date
    }

    /// "Cork semi-detached", the same name the result screen gave it.
    var title: String { ValuationSummary.title(county: county, propertyType: propertyType) }

    /// "Cork · Semi-detached · 3 bed" (Figma 09).
    var details: String { "\(county.name) · \(propertyType.title) · \(bedrooms) bed" }

    /// To the nearest €1,000, like the result screen.
    var estimate: String { "€\(EuroAmount.format(Int((estimateEur / 1000).rounded()) * 1000))" }

    /// Nil when no asking price was checked.
    var verdict: ValuationSummary.Verdict? {
        guard askingPriceEur != nil, let flagged = priceNeedsReview else { return nil }
        return flagged ? .overPriced : .fair
    }

    /// Firestore may hand back a whole number as Int, Int64 or Double; any of them reads.
    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }

    private static func whole(_ value: Any?) -> Int? {
        number(value).map { Int($0.rounded()) }
    }
}
