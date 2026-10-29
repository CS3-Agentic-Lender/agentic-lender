import XCTest
@testable import AgenticLender

/// The body of `POST /core/saved-checks`: the check that was run and the answer it got (al-core AL-272 contract).
final class SavedCheckDraftTests: XCTestCase {
    private func request(askingPrice: String) throws -> ValuationRequest {
        try XCTUnwrap(ValuationRequest(form: PropertyCheckForm(
            county: .cork, eircode: "t12x8y2", floorArea: "110", bedrooms: 3,
            propertyType: .semiDetached, berRating: .b3, askingPrice: askingPrice
        )))
    }

    private func result(gap: Double?, needsReview: Bool?) -> ValuationResult {
        ValuationResult(
            estimateEur: 345_210.5, displayEstimateEur: 345_000, basis: "2024 asking-price estimate",
            supportWarnings: ["Few homes like this one were in the data."], askingPriceGap: gap,
            priceNeedsReview: needsReview, modelVersion: "v2"
        )
    }

    private func json(_ draft: SavedCheckDraft) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
    }

    func testSendsThePropertyAndTheResultInTheAPIsNames() throws {
        let body = try json(SavedCheckDraft(request: request(askingPrice: "379,000"), result: result(gap: 0.0986, needsReview: true)))

        XCTAssertEqual(Set(body.keys), [
            "property", "estimated_value_eur", "asking_price_gap", "price_needs_review", "support_warnings", "model_version",
        ])
        let property = try XCTUnwrap(body["property"] as? [String: Any])
        XCTAssertEqual(property["county"] as? String, "Cork")
        XCTAssertEqual(property["eircode"] as? String, "T12 X8Y2")
        XCTAssertEqual(property["property_type"] as? String, "Semi-D")
        XCTAssertEqual(property["bedrooms"] as? Int, 3)
        XCTAssertEqual(property["floor_area_sqm"] as? Int, 110)
        XCTAssertEqual(property["ber_rating"] as? String, "B3")
        XCTAssertEqual(property["asking_price_eur"] as? Int, 379_000)
        XCTAssertEqual(body["estimated_value_eur"] as? Double, 345_210.5)
        XCTAssertEqual(body["asking_price_gap"] as? Double, 0.0986)
        XCTAssertEqual(body["price_needs_review"] as? Bool, true)
        XCTAssertEqual(body["support_warnings"] as? [String], ["Few homes like this one were in the data."])
        XCTAssertEqual(body["model_version"] as? String, "v2")
    }

    func testWithNoAskingPriceThePriceTheGapAndTheFlagAreLeftOut() throws {
        // al-core refuses a gap or a flag without an asking price (422).
        let body = try json(SavedCheckDraft(request: request(askingPrice: ""), result: result(gap: 0.1, needsReview: false)))

        let property = try XCTUnwrap(body["property"] as? [String: Any])
        XCTAssertNil(property["asking_price_eur"])
        XCTAssertNil(body["asking_price_gap"])
        XCTAssertNil(body["price_needs_review"])
    }
}
