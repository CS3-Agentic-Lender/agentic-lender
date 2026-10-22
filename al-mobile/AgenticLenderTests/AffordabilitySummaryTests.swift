import XCTest
@testable import AgenticLender

/// What the result screen shows for the AL-19 / AL-97 test cases, at the 4.00% test rate.
final class AffordabilitySummaryTests: XCTestCase {
    private func result(
        maxLoan: Double, price: Double, repayment: Double, stressed: Double,
        limitedBy: AffordabilityResult.Limit, rate: Double = 4.0, rateDate: String = "2026-08"
    ) -> AffordabilityResult {
        AffordabilityResult(
            maxLoanEur: maxLoan, maxPropertyPriceEur: price, monthlyRepaymentEur: repayment,
            stressedRepaymentEur: stressed, limitedBy: limitedBy, benchmarkRatePct: rate,
            stressedRatePct: rate + 2, rateDate: rateDate
        )
    }

    func testReferenceCaseOneSingleFirstTimeBuyer() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 240_000, price: 280_000, repayment: 1145.80, stressed: 1438.92, limitedBy: .income),
            termYears: 30, isFirstTimeBuyer: true
        )

        XCTAssertEqual(summary.maxLoan, "€240,000")
        XCTAssertEqual(summary.maxPropertyPrice, "€280,000")
        XCTAssertEqual(summary.monthlyRepayment, "€1,145.80")
        XCTAssertEqual(summary.stressedRepayment, "€1,438.92")
        XCTAssertEqual(summary.limit, "Limited by income (4× income)")
    }

    func testReferenceCaseTwoJointMoversLimitedByDeposit() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 270_000, price: 300_000, repayment: 1425.16, stressed: 1739.61, limitedBy: .deposit),
            termYears: 25, isFirstTimeBuyer: false
        )

        XCTAssertEqual(summary.maxLoan, "€270,000")
        XCTAssertEqual(summary.maxPropertyPrice, "€300,000")
        XCTAssertEqual(summary.monthlyRepayment, "€1,425.16")
        XCTAssertEqual(summary.stressedRepayment, "€1,739.61")
        XCTAssertEqual(summary.limit, "Limited by deposit (90% LTV)")
    }

    func testCaseThreeLimitedByDebtsRoundsTheLoanToTheEuro() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 166_791.61, price: 216_791.61, repayment: 796.29, stressed: 1000, limitedBy: .debts),
            termYears: 30, isFirstTimeBuyer: true
        )

        XCTAssertEqual(summary.maxLoan, "€166,792")
        XCTAssertEqual(summary.maxPropertyPrice, "€216,792")
        XCTAssertEqual(summary.monthlyRepayment, "€796.29")
        XCTAssertEqual(summary.stressedRepayment, "€1,000.00")
        XCTAssertEqual(summary.limit, "Limited by debts (40% of income)")
    }

    func testIncomeLimitIsThreeAndAHalfTimesForOtherBuyers() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 210_000, price: 260_000, repayment: 1002.56, stressed: 1259.06, limitedBy: .income),
            termYears: 30, isFirstTimeBuyer: false
        )

        XCTAssertEqual(summary.limit, "Limited by income (3.5× income)")
    }

    func testRateNoteShowsTheRateWithItsMonthAndSaysItIsIndicative() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 240_000, price: 280_000, repayment: 1145.80, stressed: 1438.92, limitedBy: .income),
            termYears: 30, isFirstTimeBuyer: true
        )

        XCTAssertEqual(
            summary.rateNote,
            "Repayments use the average Irish new mortgage rate, Aug 2026: 4.0%, over 30 years. Indicative, not an offer."
        )
    }

    func testRateKeepsTwoDecimalsWhenItHasThem() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 240_000, price: 280_000, repayment: 1, stressed: 1, limitedBy: .income, rate: 3.87, rateDate: "2026-01"),
            termYears: 25, isFirstTimeBuyer: true
        )

        XCTAssertTrue(summary.rateNote.hasPrefix("Repayments use the average Irish new mortgage rate, Jan 2026: 3.87%, over 25 years."))
    }

    func testAnUnreadableRateDateIsShownAsSent() {
        let summary = AffordabilitySummary(
            result: result(maxLoan: 240_000, price: 280_000, repayment: 1, stressed: 1, limitedBy: .income, rateDate: "August"),
            termYears: 30, isFirstTimeBuyer: true
        )

        XCTAssertTrue(summary.rateNote.contains("rate, August: 4.0%"))
    }
}
