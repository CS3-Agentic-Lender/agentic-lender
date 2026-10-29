import Foundation

/// What `POST /ai/valuation` returns, as far as the property check uses it.
///
/// Everything here is the model's ESTIMATE of a 2024 asking price, not a valuation, and the screen
/// must say so.
struct ValuationResult: Decodable, Hashable {
    let estimateEur: Double
    /// The estimate to the nearest €1,000, as the screen shows it.
    let displayEstimateEur: Int
    /// "2024 asking-price estimate".
    let basis: String
    /// Plain-English reasons the estimate is less reliable, such as a BER of A0.
    let supportWarnings: [String]
    /// Asking price / estimate − 1. Nil when no asking price was sent.
    let askingPriceGap: Double?
    /// True when the asking price is far enough above the estimate to need a review. Nil with no asking price.
    let priceNeedsReview: Bool?
    /// The model's average estimate over its sample homes, where the breakdown starts. Nil together
    /// with `contributions` when the breakdown couldn't be worked out; the estimate is still good then.
    let baselineEur: Double?
    /// One piece per detail of the home; the baseline plus every piece is `estimateEur`.
    let contributions: [ValuationContribution]?

    static func decode(_ data: Data) throws -> ValuationResult {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(ValuationResult.self, from: data)
    }
}

/// How far one detail of the home moved the estimate from the baseline, in euro.
struct ValuationContribution: Decodable, Hashable {
    /// `county`, `property_type`, `bedrooms`, `floor_area`, `ber` or `eircode_area`. Kept as text so a
    /// detail added to the model later doesn't stop the whole answer from being read.
    let feature: String
    /// Positive when it added to the estimate, negative when it took off.
    let eur: Double
}

/// Estimates a home's 2024 asking price from its details, through the valuation endpoint.
protocol ValuationService: Sendable {
    func value(_ request: ValuationRequest) async throws -> ValuationResult
}
