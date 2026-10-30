import XCTest
@testable import AgenticLender

/// What the app reads from `POST /ai/valuation`. The result screen itself is AL-144.
final class ValuationResultTests: XCTestCase {
    func testReadsTheEstimateAndThePriceCheck() throws {
        let result = try ValuationResult.decode(ValuationRequestTests.referenceResponse)

        XCTAssertEqual(result.estimateEur, 371_800)
        XCTAssertEqual(result.displayEstimateEur, 372_000)
        XCTAssertEqual(result.basis, "2024 asking-price estimate")
        XCTAssertEqual(result.supportWarnings, [])
        XCTAssertEqual(result.askingPriceGap, 0.0221)
        XCTAssertEqual(result.priceNeedsReview, false)
    }

    func testWithoutAnAskingPriceThereIsNoPriceCheck() throws {
        let json = Data("""
        {"estimate_eur": 371800, "display_estimate_eur": 372000, "basis": "2024 asking-price estimate",
         "support_warnings": ["BER A0 is not a grade the model was trained on, so it is valued as an unknown rating."],
         "model_version": "v2", "schema_version": "1", "asking_price_gap": null, "price_needs_review": null,
         "baseline_eur": null, "contributions": null}
        """.utf8)

        let result = try ValuationResult.decode(json)

        XCTAssertNil(result.askingPriceGap)
        XCTAssertNil(result.priceNeedsReview)
        XCTAssertEqual(result.supportWarnings.count, 1)
    }

    // MARK: - The breakdown (AL-136 criterion 2)

    func testReadsTheBreakdownAndItAddsUpToTheEstimate() throws {
        let result = try ValuationResult.decode(ValuationRequestTests.referenceResponse)

        let baseline = try XCTUnwrap(result.baselineEur)
        let pieces = try XCTUnwrap(result.contributions)
        XCTAssertEqual(baseline, 312_000)
        XCTAssertEqual(pieces.map(\.feature), ["floor_area", "county", "bedrooms", "eircode_area", "property_type", "ber"])
        XCTAssertEqual(pieces.first?.eur, 31_200)
        XCTAssertEqual(baseline + pieces.map(\.eur).reduce(0, +), result.estimateEur, accuracy: 0.01)
    }

    func testARealAnswerInCentsAddsUpToTheEstimate() throws {
        // al-ai's answer for a 110 m² Cork semi-D, BER B3, T12 (model v2), each piece rounded to the cent.
        let json = Data("""
        {"estimate_eur": 419099.38, "display_estimate_eur": 419000, "basis": "2024 asking-price estimate",
         "support_warnings": [], "model_version": "v2", "schema_version": "1",
         "asking_price_gap": null, "price_needs_review": null, "baseline_eur": 576575.36,
         "contributions": [
           {"feature": "floor_area", "value": 110.0, "eur": -108356.62},
           {"feature": "county", "value": "Cork", "eur": -91422.75},
           {"feature": "eircode_area", "value": "T12", "eur": 75119.64},
           {"feature": "property_type", "value": "Semi-D", "eur": -27580.75},
           {"feature": "bedrooms", "value": 3, "eur": -16178.58},
           {"feature": "ber", "value": "B3", "eur": 10943.09}
         ]}
        """.utf8)

        let result = try ValuationResult.decode(json)

        let pieces = try XCTUnwrap(result.contributions)
        XCTAssertEqual(pieces.count, 6)
        XCTAssertEqual(try XCTUnwrap(result.baselineEur) + pieces.map(\.eur).reduce(0, +), result.estimateEur, accuracy: 0.05)
    }

    func testWithoutABreakdownBothPartsAreMissing() throws {
        let json = Data("""
        {"estimate_eur": 371800, "display_estimate_eur": 372000, "basis": "2024 asking-price estimate",
         "support_warnings": ["The breakdown of this estimate isn't available right now."],
         "model_version": "v2", "schema_version": "1", "asking_price_gap": null, "price_needs_review": null,
         "baseline_eur": null, "contributions": null}
        """.utf8)

        let result = try ValuationResult.decode(json)

        XCTAssertNil(result.baselineEur)
        XCTAssertNil(result.contributions)
        XCTAssertEqual(result.estimateEur, 371_800)
    }

    func testAnAnswerWithoutAnEstimateIsRejected() {
        XCTAssertThrowsError(try ValuationResult.decode(Data(#"{"basis": "2024 asking-price estimate"}"#.utf8)))
    }
}
