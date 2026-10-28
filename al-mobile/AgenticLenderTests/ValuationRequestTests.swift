import XCTest
@testable import AgenticLender

/// The body sent to `POST /ai/valuation` (AL-143 criterion 4, the contract in docs/api-design.md).
final class ValuationRequestTests: XCTestCase {
    /// The reference home in the API docs: a Cork semi-D listed at €380,000, with the breakdown.
    static let referenceResponse = Data("""
    {
      "estimate_eur": 371800, "display_estimate_eur": 372000, "basis": "2024 asking-price estimate",
      "support_warnings": [], "model_version": "v2", "schema_version": "1",
      "asking_price_gap": 0.0221, "price_needs_review": false, "baseline_eur": 312000,
      "contributions": [
        {"feature": "floor_area", "value": 98, "eur": 31200},
        {"feature": "county", "value": "Cork", "eur": 18500},
        {"feature": "bedrooms", "value": 3, "eur": 9800},
        {"feature": "eircode_area", "value": "T12", "eur": 6200},
        {"feature": "property_type", "value": "Semi-D", "eur": -4600},
        {"feature": "ber", "value": "C", "eur": -1300}
      ]
    }
    """.utf8)

    static func form(askingPrice: String = "379,000") -> PropertyCheckForm {
        PropertyCheckForm(
            county: .cork, eircode: "t12x8y2", floorArea: "1,100", bedrooms: 3,
            propertyType: .semiDetached, berRating: .a0, askingPrice: askingPrice
        )
    }

    private func sentBody(_ request: ValuationRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: request.body()) as? [String: Any])
    }

    func testAFormWithAnErrorMakesNoRequest() {
        var form = Self.form()
        form.county = nil

        XCTAssertNil(ValuationRequest(form: form))
    }

    func testSendsTheModelsSpellingsAndTheTidiedEircode() throws {
        let body = try sentBody(XCTUnwrap(ValuationRequest(form: Self.form())))

        XCTAssertEqual(body["county"] as? String, "Cork")
        XCTAssertEqual(body["eircode"] as? String, "T12 X8Y2")
        XCTAssertEqual(body["floor_area_m2"] as? Int, 1100)
        XCTAssertEqual(body["bedrooms"] as? Int, 3)
        XCTAssertEqual(body["property_type"] as? String, "Semi-D")
        XCTAssertEqual(body["ber"] as? String, "A0")
        XCTAssertEqual(body["asking_price_eur"] as? Int, 379_000)
        XCTAssertEqual(
            Set(body.keys),
            ["county", "eircode", "floor_area_m2", "bedrooms", "property_type", "ber", "asking_price_eur"]
        )
    }

    /// The endpoint forbids unknown fields and treats a missing asking price as "no comparison".
    func testLeavesOutAnAskingPriceThatWasNotGiven() throws {
        let body = try sentBody(XCTUnwrap(ValuationRequest(form: Self.form(askingPrice: ""))))

        XCTAssertNil(body["asking_price_eur"])
    }
}
