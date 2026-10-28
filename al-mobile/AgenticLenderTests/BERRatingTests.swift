import XCTest
@testable import AgenticLender

/// The BER grades the app offers for a home. The SEAI scale changed on 24 May 2026 (A0 and A to G,
/// no subgrades) and older certificates stay valid, so the property check offers both scales.
final class BERRatingTests: XCTestCase {
    func testTheOlderScaleIsTheFifteenSEAIGradesInOrder() {
        XCTAssertEqual(
            BERRating.olderScale.map(\.rawValue),
            ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "D1", "D2", "E1", "E2", "F", "G"]
        )
    }

    func testTheNewScaleIsA0ThenAToG() {
        XCTAssertEqual(BERRating.newScale.map(\.rawValue), ["A0", "A", "B", "C", "D", "E", "F", "G"])
    }

    /// The affordability and HELOC endpoints don't take A0, so those forms keep the list they had.
    func testAffordabilityFormsStillOfferTheOlderScaleThenUnknown() {
        let offered = BERRating.affordabilityGroups.flatMap(\.ratings).map(\.rawValue)

        XCTAssertEqual(
            offered,
            ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "D1", "D2", "E1", "E2", "F", "G", "Unknown"]
        )
    }

    /// Figma 10b: Don't know, then the new scale, then the older one.
    func testThePropertyCheckOffersDontKnowThenBothScales() {
        let groups = BERRating.valuationGroups

        XCTAssertEqual(groups.map(\.title), [nil, "Certificate from 24 May 2026", "Older certificate"])
        XCTAssertEqual(groups[0].ratings, [.unknown])
        XCTAssertEqual(groups[1].ratings, BERRating.newScale)
        XCTAssertEqual(groups[2].ratings, BERRating.olderScale)
    }

    func testGradesShowAsTheyAreAndUnknownReadsAsPlainEnglish() {
        XCTAssertEqual(BERRating.b3.title, "B3")
        XCTAssertEqual(BERRating.a0.title, "A0")
        XCTAssertEqual(BERRating.unknown.title, "I don't know")
    }
}
