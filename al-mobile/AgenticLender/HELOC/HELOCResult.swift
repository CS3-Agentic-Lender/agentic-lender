import Foundation

/// What `POST /ai/affordability` returns for a HELOC (Nic on AL-198).
///
/// Amounts are euro and keep the precision the endpoint sends; they are rounded only for display.
/// The home's value is the model's indicative estimate from 2024 asking prices, not a valuation.
struct HELOCResult: Decodable, Hashable {
    let homeValueEur: Double
    let maxLineEur: Double
    let combinedLtv: Double
    /// The line fully drawn, at the benchmark rate.
    let monthlyRepaymentEur: Double
    /// The line fully drawn, at the benchmark rate plus 2 points.
    let stressedRepaymentEur: Double
    let limitedBy: Limit
    let benchmarkRatePct: Double
    let stressedRatePct: Double
    /// The month of the benchmark rate, `YYYY-MM`.
    let rateDate: String

    /// A HELOC line is only ever capped by equity: 80% of the value, less what is still owed.
    enum Limit: String, Decodable, Hashable {
        case equity
    }

    /// False when what's owed is already at or above 80% of the value, so the line is €0.
    var hasEquity: Bool { maxLineEur > 0 }

    static func decode(_ data: Data) throws -> HELOCResult {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(HELOCResult.self, from: data)
    }
}

/// Works out the most a homeowner can borrow against their home, through the affordability endpoint.
protocol HELOCService: Sendable {
    func checkHELOC(_ request: HELOCRequest) async throws -> HELOCResult
}
