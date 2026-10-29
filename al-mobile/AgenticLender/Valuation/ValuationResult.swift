import Foundation

/// What `POST /ai/valuation` returns, as far as the property check uses it.
///
/// Everything here is the model's ESTIMATE of a 2024 asking price, not a valuation, and the screen
/// must say so. The breakdown (`baseline_eur`, `contributions`) is read by the breakdown subtask.
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
    /// The model that made the estimate, such as "v2". Kept with a saved check.
    let modelVersion: String

    static func decode(_ data: Data) throws -> ValuationResult {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(ValuationResult.self, from: data)
    }
}

/// Estimates a home's 2024 asking price from its details, through the valuation endpoint.
protocol ValuationService: Sendable {
    func value(_ request: ValuationRequest) async throws -> ValuationResult
}
