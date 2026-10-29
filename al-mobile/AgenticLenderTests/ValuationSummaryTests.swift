import XCTest
@testable import AgenticLender

/// The property check result's text (AL-144 criterion 1, Figma 11 to 11c).
final class ValuationSummaryTests: XCTestCase {
    private func request(
        type: PropertyType = .semiDetached, bedrooms: Int = 3, floorArea: String = "110",
        ber: BERRating = .b3, askingPrice: String = "379,000"
    ) throws -> ValuationRequest {
        try XCTUnwrap(ValuationRequest(form: PropertyCheckForm(
            county: .cork, eircode: "T12 X8Y2", floorArea: floorArea, bedrooms: bedrooms,
            propertyType: type, berRating: ber, askingPrice: askingPrice
        )))
    }

    private func result(
        estimate: Double = 345_000, display: Int = 345_000, gap: Double? = 0.0986, flagged: Bool? = true, warnings: [String] = []
    ) -> ValuationResult {
        ValuationResult(
            estimateEur: estimate, displayEstimateEur: display, basis: "2024 asking-price estimate",
            supportWarnings: warnings, askingPriceGap: gap, priceNeedsReview: flagged, modelVersion: "v2"
        )
    }

    // MARK: - Heading

    func testHeadingNamesTheHomeAndItsDetails() throws {
        let text = ValuationSummary(request: try request(), result: result())

        XCTAssertEqual(text.title, "Cork semi-detached")
        XCTAssertEqual(text.details, "Semi-detached · 3 bed · 110 m² · BER B3")
    }

    func testDetailsGroupALargeSizeAndSayWhenTheBERIsNotKnown() throws {
        let text = ValuationSummary(request: try request(type: .apartment, bedrooms: 1, floorArea: "1,100", ber: .unknown), result: result())

        XCTAssertEqual(text.title, "Cork apartment")
        XCTAssertEqual(text.details, "Apartment · 1 bed · 1,100 m² · BER not known")
    }

    // MARK: - Estimate

    /// Criterion 1: the estimate to the nearest €1,000, labelled as based on 2024 asking prices.
    func testEstimateIsToTheNearestThousandAndSaysWhatItIsBasedOn() throws {
        let text = ValuationSummary(request: try request(), result: result(estimate: 371_800, display: 372_000))

        XCTAssertEqual(text.estimate, "€372,000")
        XCTAssertEqual(text.basis, "Estimate based on 2024 asking prices, to the nearest €1,000. Not a valuation.")
    }

    // MARK: - Asking price

    /// Figma 11: flagged for review shows Over-priced, with how far above the estimate it is.
    func testAFlaggedAskingPriceIsOverPriced() throws {
        let text = ValuationSummary(request: try request(), result: result())

        XCTAssertEqual(text.verdict, .overPriced)
        XCTAssertEqual(text.askingPrice, "€379,000")
        XCTAssertEqual(text.comparison, "The asking price is €34,000 (10%) above the estimate, so the model flags it for review.")
    }

    /// Figma 11a: not flagged shows Fair. The model only flags prices above the estimate.
    func testAnUnflaggedAskingPriceAboveTheEstimateIsFair() throws {
        let text = ValuationSummary(request: try request(askingPrice: "350,000"), result: result(gap: 0.0145, flagged: false))

        XCTAssertEqual(text.verdict, .fair)
        XCTAssertEqual(text.comparison, "The asking price is €5,000 (1%) above the estimate, which the model doesn't flag.")
    }

    func testAnAskingPriceBelowTheEstimateIsFairAndSaysBelow() throws {
        let text = ValuationSummary(request: try request(askingPrice: "300,000"), result: result(gap: -0.1304, flagged: false))

        XCTAssertEqual(text.verdict, .fair)
        XCTAssertEqual(text.comparison, "The asking price is €45,000 (13%) below the estimate, which the model doesn't flag.")
    }

    func testAnAskingPriceEqualToTheEstimateSaysSo() throws {
        let text = ValuationSummary(request: try request(askingPrice: "345,000"), result: result(gap: 0, flagged: false))

        XCTAssertEqual(text.comparison, "The asking price is the same as the estimate, which the model doesn't flag.")
    }

    /// Figma 11c: with no asking price there is nothing to compare.
    func testWithoutAnAskingPriceThereIsNoVerdict() throws {
        let text = ValuationSummary(request: try request(askingPrice: ""), result: result(gap: nil, flagged: nil))

        XCTAssertNil(text.verdict)
        XCTAssertNil(text.askingPrice)
        XCTAssertNil(text.comparison)
    }

    // MARK: - Warnings

    /// Figma 11b: the endpoint's warnings are shown as it words them.
    func testWarningsAreShownAsTheEndpointWordsThem() throws {
        let warning = "BER A0 is not a grade the model was trained on, so it is valued as an unknown rating."
        let text = ValuationSummary(request: try request(ber: .a0), result: result(warnings: [warning]))

        XCTAssertEqual(text.warnings, [warning])
    }

    // MARK: - Verdict labels

    func testVerdictsReadAsInTheFigma() {
        XCTAssertEqual(ValuationSummary.Verdict.overPriced.label, "Over-priced")
        XCTAssertEqual(ValuationSummary.Verdict.fair.label, "Fair")
    }
}
