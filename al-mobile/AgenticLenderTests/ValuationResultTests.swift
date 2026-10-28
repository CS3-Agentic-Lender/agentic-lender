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

    func testAnAnswerWithoutAnEstimateIsRejected() {
        XCTAssertThrowsError(try ValuationResult.decode(Data(#"{"basis": "2024 asking-price estimate"}"#.utf8)))
    }
}
