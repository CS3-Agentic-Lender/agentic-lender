import XCTest
@testable import AgenticLender

/// The HELOC result screen's text (AL-207 criteria 3 and 4, AL-195 criterion 5).
final class HELOCSummaryTests: XCTestCase {
    private func summary(_ data: Data, termYears: Int = 20) throws -> HELOCSummary {
        HELOCSummary(result: try HELOCResult.decode(data), termYears: termYears)
    }

    /// The figures the local endpoint gives for AL-195 test case 1, as the app shows them.
    func testReferenceCaseShowsTheEndpointsFigures() throws {
        let text = try summary(HELOCRequestTests.referenceResponse)

        XCTAssertEqual(text.maxLine, "€59,883")
        XCTAssertEqual(text.estimatedValue, "€262,354")
        XCTAssertEqual(text.monthlyRepayment, "€362.88")
        XCTAssertEqual(text.stressedRepayment, "€429.02")
        XCTAssertEqual(text.limit, "Limited by equity (80% of the estimated value, less what you owe)")
        XCTAssertNil(text.noEquity)
    }

    func testALineOfZeroSaysThereIsNoEquity() throws {
        let text = try summary(HELOCRequestTests.noEquityResponse)

        XCTAssertEqual(text.maxLine, "€0")
        XCTAssertEqual(
            text.noEquity,
            "No equity available. You owe 80% or more of the estimated value, so there's nothing to borrow against yet."
        )
    }

    func testRateNoteSaysIndicativeAndThatTheValueIsAnEstimate() throws {
        let note = try summary(HELOCRequestTests.referenceResponse, termYears: 15).rateNote

        XCTAssertEqual(
            note,
            "Repayments assume the full line is drawn, at the average Irish new mortgage rate, Aug 2026: 4.0%, over 15 years. "
                + "The estimated value is the model's estimate from 2024 property listings, not a valuation. Indicative, not an offer."
        )
    }

    /// AL-195 criterion 5: the HELOC screens say "estimated value", never "asking price".
    func testNoTextSaysAskingPrice() throws {
        for data in [HELOCRequestTests.referenceResponse, HELOCRequestTests.noEquityResponse] {
            let text = try summary(data)
            let all = [text.maxLine, text.estimatedValue, text.limit, text.rateNote, text.noEquity ?? ""].joined(separator: " ")

            XCTAssertFalse(all.localizedCaseInsensitiveContains("asking price"), all)
        }
    }
}
