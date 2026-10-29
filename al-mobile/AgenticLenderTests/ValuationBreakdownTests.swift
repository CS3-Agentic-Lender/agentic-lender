import XCTest
@testable import AgenticLender

/// The breakdown section on the property result (AL-136, Figma 11e).
final class ValuationBreakdownTests: XCTestCase {
    private func request(
        type: PropertyType = .semiDetached, bedrooms: Int = 3, floorArea: String = "110",
        ber: BERRating = .b3, eircode: String = "T12 X8Y2"
    ) throws -> ValuationRequest {
        try XCTUnwrap(ValuationRequest(form: PropertyCheckForm(
            county: .cork, eircode: eircode, floorArea: floorArea, bedrooms: bedrooms,
            propertyType: type, berRating: ber, askingPrice: ""
        )))
    }

    private func result(
        estimate: Double, display: Int, baseline: Double?, pieces: [(String, Double)]?
    ) -> ValuationResult {
        ValuationResult(
            estimateEur: estimate, displayEstimateEur: display, basis: "2024 asking-price estimate",
            supportWarnings: [], askingPriceGap: nil, priceNeedsReview: nil, modelVersion: "v2",
            baselineEur: baseline,
            contributions: pieces?.map { ValuationContribution(feature: $0.0, eur: $0.1) }
        )
    }

    /// al-ai's real answer for a 110 m² Cork semi-D, BER B3, T12 (model v2).
    private var corkResult: ValuationResult {
        result(estimate: 419_099.38, display: 419_000, baseline: 576_575.36, pieces: [
            ("floor_area", -108_356.62), ("county", -91_422.75), ("eircode_area", 75_119.64),
            ("property_type", -27_580.75), ("bedrooms", -16_178.58), ("ber", 10_943.09),
        ])
    }

    private func sumOfShownRows(_ breakdown: ValuationBreakdown) -> Int {
        breakdown.rows.map(\.thousands).reduce(0, +) + breakdown.startingPointThousands
    }

    // MARK: - Criterion 1: the baseline, each detail largest first with a sign, then the estimate

    func testListsTheStartingPointEachDetailLargestFirstAndTheEstimate() throws {
        let breakdown = try XCTUnwrap(ValuationBreakdown(request: try request(), result: try ValuationResult.decode(ValuationRequestTests.referenceResponse)))

        XCTAssertEqual(breakdown.startingPoint, "€312,000")
        XCTAssertEqual(breakdown.rows.map(\.label), [
            "Floor area: 110 m²", "County: Cork", "Bedrooms: 3", "Eircode area: T12", "Type: Semi-detached", "BER: B3",
        ])
        XCTAssertEqual(breakdown.rows.map(\.amount), ["+€31,000", "+€19,000", "+€10,000", "+€6,000", "−€5,000", "−€1,000"])
        XCTAssertEqual(breakdown.estimate, "€372,000")
    }

    func testTheBaselineIsCalledTheStartingPointNeverATypicalPrice() {
        // AL-132 criterion 2: the baseline (about €577,000) is the average of the model's sample homes,
        // well above the middle home (about €396,000), so calling it typical would mislead.
        XCTAssertEqual(ValuationBreakdown.title, "How each detail moved the estimate")
        XCTAssertEqual(ValuationBreakdown.startingPointLabel, "Starting point")
        XCTAssertEqual(ValuationBreakdown.startingPointNote, "average of the model's sample homes")
        XCTAssertEqual(
            ValuationBreakdown.explanation,
            "Starts from the average of the model's sample homes, not a typical price. It doesn't say what changing the house would do."
        )
        let shown = [ValuationBreakdown.title, ValuationBreakdown.startingPointLabel, ValuationBreakdown.startingPointNote]
        XCTAssertFalse(shown.contains { $0.localizedCaseInsensitiveContains("typical") || $0.localizedCaseInsensitiveContains("listing") })
    }

    func testTheLargestDetailComesFirstWhateverOrderTheyArriveIn() throws {
        let shuffled = result(estimate: 345_000, display: 345_000, baseline: 310_000, pieces: [
            ("ber", -3_000), ("county", 22_000), ("bedrooms", -5_000), ("floor_area", 15_000), ("property_type", 6_000), ("eircode_area", 0),
        ])

        let breakdown = try XCTUnwrap(ValuationBreakdown(request: try request(), result: shuffled))

        XCTAssertEqual(breakdown.rows.map(\.amount), ["+€22,000", "+€15,000", "+€6,000", "−€5,000", "−€3,000", "€0"])
    }

    func testEachRowSaysWhichWayItMovedTheEstimate() throws {
        let breakdown = try XCTUnwrap(ValuationBreakdown(request: try request(), result: result(
            estimate: 327_000, display: 327_000, baseline: 310_000, pieces: [("county", 22_000), ("ber", -5_000), ("eircode_area", 0)]
        )))

        XCTAssertEqual(breakdown.rows.map(\.change), [.up, .down, .none])
        XCTAssertEqual(breakdown.rows.map(\.spoken), [
            "County: Cork, adds €22,000", "BER: B3, takes off €5,000", "Eircode area: T12, no change",
        ])
    }

    // MARK: - Labels come from the details the borrower entered

    func testLabelsUseTheDetailsTheBorrowerEntered() throws {
        let home = try request(type: .apartment, bedrooms: 1, floorArea: "1,100", ber: .unknown, eircode: "D6W F4E2")
        let pieces = ["county", "property_type", "bedrooms", "floor_area", "ber", "eircode_area"].map { ($0, 1_000.0) }

        let breakdown = try XCTUnwrap(ValuationBreakdown(request: home, result: result(
            estimate: 316_000, display: 316_000, baseline: 310_000, pieces: pieces
        )))

        XCTAssertEqual(Set(breakdown.rows.map(\.label)), [
            "County: Cork", "Type: Apartment", "Bedrooms: 1", "Floor area: 1,100 m²", "BER: not known", "Eircode area: D6W",
        ])
    }

    func testADetailTheAppDoesNotKnowStillShowsUnderItsOwnName() throws {
        let breakdown = try XCTUnwrap(ValuationBreakdown(request: try request(), result: result(
            estimate: 312_000, display: 312_000, baseline: 310_000, pieces: [("garden_size", 2_000)]
        )))

        XCTAssertEqual(breakdown.rows.map(\.label), ["garden_size"])
    }

    // MARK: - The rounded rows add up to the estimate the screen shows

    func testRoundedRowsAreNudgedToAddUpToTheShownEstimate() throws {
        // Rounded on their own these rows come to €420,000, but the headline is €419,000.
        let breakdown = try XCTUnwrap(ValuationBreakdown(request: try request(), result: corkResult))

        XCTAssertEqual(breakdown.startingPoint, "€577,000")
        XCTAssertEqual(breakdown.rows.map(\.amount), ["−€108,000", "−€92,000", "+€75,000", "−€28,000", "−€16,000", "+€11,000"])
        XCTAssertEqual(sumOfShownRows(breakdown), 419)
        XCTAssertEqual(breakdown.estimate, "€419,000")
    }

    func testNudgingUpPicksTheRowsThatWereRoundedDownTheMost() {
        // 1.4 + 2.4 + 3.1 rounds to 1 + 2 + 3 = 6; the shown total is 8, so the two rows nearest to rounding up gain one.
        XCTAssertEqual(ValuationBreakdown.thousands([1_400, 2_400, 3_100], addingUpTo: 8), [2, 3, 3])
    }

    func testNudgingDownPicksTheRowsThatWereRoundedUpTheMost() {
        XCTAssertEqual(ValuationBreakdown.thousands([1_600, -2_600, 3_100], addingUpTo: 1), [1, -3, 3])
    }

    func testRowsThatAlreadyAddUpAreLeftAlone() {
        XCTAssertEqual(ValuationBreakdown.thousands([22_000, -5_000, 0], addingUpTo: 17), [22, -5, 0])
    }

    // MARK: - Criterion 3: no breakdown, no section

    func testHiddenWhenTheAnswerHasNoBreakdown() throws {
        XCTAssertNil(ValuationBreakdown(request: try request(), result: result(estimate: 345_000, display: 345_000, baseline: nil, pieces: nil)))
    }

    func testHiddenWhenTheBreakdownHasNoPieces() throws {
        XCTAssertNil(ValuationBreakdown(request: try request(), result: result(estimate: 345_000, display: 345_000, baseline: 345_000, pieces: [])))
    }

    func testHiddenWhenThePiecesDoNotAddUpToTheEstimate() throws {
        // A breakdown that contradicts the estimate would mislead, so it isn't shown.
        let wrong = result(estimate: 345_000, display: 345_000, baseline: 310_000, pieces: [("county", 22_000)])

        XCTAssertNil(ValuationBreakdown(request: try request(), result: wrong))
    }
}
