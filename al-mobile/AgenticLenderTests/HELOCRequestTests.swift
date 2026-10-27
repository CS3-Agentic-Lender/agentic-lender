import XCTest
@testable import AgenticLender

/// What the HELOC check sends to `POST /ai/affordability` and reads back (AL-207 criteria 2, 4 and 5).
/// The request fields and the response follow Nic's answer on the HELOC endpoint ticket (AL-198).
final class HELOCRequestTests: XCTestCase {
    /// AL-195 test case 1: Cork, 110 m², 3 bedrooms, semi-detached, B3, €150,000 left,
    /// €70,000 income, €300 monthly debts, 20 years.
    static let referenceForm = HELOCCheckForm(
        county: .cork,
        propertyType: .semiDetached,
        floorArea: "110",
        bedrooms: 3,
        berRating: .b3,
        mortgageBalance: "150,000",
        income: "70,000",
        monthlyDebts: "300",
        termYears: 20
    )

    /// The local endpoint's answer for that form on 27 Oct 2026.
    static let referenceResponse = Data("""
    {"home_value_eur":262353.72,"max_line_eur":59882.97,"combined_ltv":0.8,"monthly_repayment_eur":362.88,\
    "stressed_repayment_eur":429.02,"limited_by":"equity","benchmark_rate_pct":4.0,"stressed_rate_pct":6.0,"rate_date":"2026-08"}
    """.utf8)

    /// The same home with €400,000 left: above 80% of the value, so no equity.
    static let noEquityResponse = Data("""
    {"home_value_eur":262353.72,"max_line_eur":0.0,"combined_ltv":1.524659,"monthly_repayment_eur":0.0,\
    "stressed_repayment_eur":0.0,"limited_by":"equity","benchmark_rate_pct":4.0,"stressed_rate_pct":6.0,"rate_date":"2026-08"}
    """.utf8)

    private func body(of form: HELOCCheckForm) throws -> [String: Any] {
        let request = try XCTUnwrap(HELOCRequest(form: form))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: request.body()) as? [String: Any])
    }

    // MARK: - Request

    func testSendsLoanTypeHelocWithTheHouseDetailsAndAmounts() throws {
        let json = try body(of: Self.referenceForm)

        XCTAssertEqual(json["loan_type"] as? String, "heloc")
        XCTAssertEqual(json["county"] as? String, "Cork")
        XCTAssertEqual(json["property_type"] as? String, "Semi-D")
        XCTAssertEqual(json["bedrooms"] as? Int, 3)
        XCTAssertEqual(json["floor_area_m2"] as? Int, 110)
        XCTAssertEqual(json["ber_rating"] as? String, "B3")
        XCTAssertEqual(json["existing_mortgage_balance_eur"] as? Int, 150_000)
        XCTAssertEqual(json["gross_income_eur"] as? Int, 70_000)
        XCTAssertEqual(json["monthly_debts_eur"] as? Int, 300)
        XCTAssertEqual(json["term_years"] as? Int, 20)
    }

    /// The endpoint refuses unknown fields, and the home's value must come from the model.
    func testSendsNoHomeValueAndNoMortgageOnlyFields() throws {
        let json = try body(of: Self.referenceForm)

        XCTAssertEqual(Set(json.keys), [
            "loan_type", "county", "property_type", "bedrooms", "floor_area_m2", "ber_rating",
            "existing_mortgage_balance_eur", "gross_income_eur", "monthly_debts_eur", "term_years",
        ])
    }

    func testUnknownBERIsSentAsTheModelsUnknown() throws {
        var form = Self.referenceForm
        form.berRating = .unknown

        XCTAssertEqual(try body(of: form)["ber_rating"] as? String, "Unknown")
    }

    func testAnInvalidFormMakesNoRequest() {
        var form = Self.referenceForm
        form.propertyType = nil

        XCTAssertNil(HELOCRequest(form: form))
    }

    // MARK: - Response

    func testDecodesTheEndpointsAnswer() throws {
        let result = try HELOCResult.decode(Self.referenceResponse)

        XCTAssertEqual(result.homeValueEur, 262_353.72)
        XCTAssertEqual(result.maxLineEur, 59_882.97)
        XCTAssertEqual(result.combinedLtv, 0.8)
        XCTAssertEqual(result.monthlyRepaymentEur, 362.88)
        XCTAssertEqual(result.stressedRepaymentEur, 429.02)
        XCTAssertEqual(result.limitedBy, .equity)
        XCTAssertEqual(result.benchmarkRatePct, 4.0)
        XCTAssertEqual(result.stressedRatePct, 6.0)
        XCTAssertEqual(result.rateDate, "2026-08")
        XCTAssertTrue(result.hasEquity)
    }

    func testALineOfZeroMeansNoEquity() throws {
        let result = try HELOCResult.decode(Self.noEquityResponse)

        XCTAssertEqual(result.maxLineEur, 0)
        XCTAssertFalse(result.hasEquity)
    }

    func testAnAnswerMissingAFieldDoesNotDecode() {
        XCTAssertThrowsError(try HELOCResult.decode(Data(#"{"max_line_eur": 1000}"#.utf8)))
    }

    func testAnUnknownLimitDoesNotDecode() {
        let text = String(decoding: Self.referenceResponse, as: UTF8.self).replacingOccurrences(of: "\"equity\"", with: "\"debts\"")

        XCTAssertThrowsError(try HELOCResult.decode(Data(text.utf8)))
    }
}
