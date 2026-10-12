import Foundation

/// What `POST /ai/affordability` returns, as agreed with the AI service on AL-57.
///
/// Amounts are euro and keep the precision the endpoint sends; they are rounded only for display.
struct AffordabilityResult: Decodable, Hashable {
    let maxLoanEur: Double
    let maxPropertyPriceEur: Double
    let monthlyRepaymentEur: Double
    let stressedRepaymentEur: Double
    let limitedBy: Limit
    let benchmarkRatePct: Double
    let stressedRatePct: Double
    /// The month of the benchmark rate, `YYYY-MM`.
    let rateDate: String

    /// Which of the three limits set the maximum loan. The 4× / 3.5× income cap counts as `income`.
    enum Limit: String, Decodable, Hashable {
        case income
        case deposit
        case debts
    }

    static func decode(_ data: Data) throws -> AffordabilityResult {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(AffordabilityResult.self, from: data)
    }
}

extension AffordabilityRequest {
    /// The household income the endpoint expects: both incomes added up for a joint application.
    var householdGrossIncome: Int { grossIncome + (secondGrossIncome ?? 0) }

    /// The JSON body for `POST /ai/affordability`.
    func body() throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return try encoder.encode(Body(
            grossIncomeEur: householdGrossIncome,
            monthlyDebtsEur: monthlyDebts,
            depositEur: deposit,
            termYears: termYears,
            firstTimeBuyer: isFirstTimeBuyer
        ))
    }

    private struct Body: Encodable {
        let grossIncomeEur: Int
        let monthlyDebtsEur: Int
        let depositEur: Int
        let termYears: Int
        let firstTimeBuyer: Bool
    }
}
