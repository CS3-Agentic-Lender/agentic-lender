import XCTest
@testable import AgenticLender

/// The BER grades the app offers for a home: the SEAI A1 to G grades, plus Unknown,
/// which the valuation model accepts (Nic, on the valuation endpoint ticket).
final class BERRatingTests: XCTestCase {
    func testOffersTheFifteenSEAIGradesInOrderThenUnknown() {
        XCTAssertEqual(
            BERRating.allCases.map(\.rawValue),
            ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "D1", "D2", "E1", "E2", "F", "G", "Unknown"]
        )
    }

    func testGradesShowAsTheyAreAndUnknownReadsAsPlainEnglish() {
        XCTAssertEqual(BERRating.b3.title, "B3")
        XCTAssertEqual(BERRating.unknown.title, "I don't know")
    }
}
