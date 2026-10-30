import XCTest
@testable import AgenticLender

/// The LTV, DTI and approval likelihood tiles on the status screen (AL-145, Figma 14 and 14e),
/// read with the field names agreed on the backend ticket: `purchaseLtvPct` for a purchase,
/// `ltvPct` (combined) for a HELOC, `dtiPct`, and `approvalLikelihood` as a label.
final class LoanFiguresTests: XCTestCase {
    private func record(_ extra: [String: Any]) throws -> ApplicationStatusRecord {
        try XCTUnwrap(ApplicationStatusRecord(fields: ["status": "AI Deliberated"].merging(extra) { $1 }))
    }

    // MARK: - Criterion 1: read from the application record

    func testAPurchaseReadsItsPurchasePriceLTV() throws {
        let figures = try record([
            "loanType": "mortgage", "purchaseLtvPct": 87.6, "ltvPct": 101.2, "dtiPct": 24.6, "approvalLikelihood": "High",
        ]).figures

        XCTAssertEqual(figures.ltv, LoanFigures.Tile(title: "LTV", value: "87.6%", note: "limit 90%"))
        XCTAssertEqual(figures.dti, LoanFigures.Tile(title: "DTI", value: "24.6%", note: "of income"))
        XCTAssertEqual(figures.likelihood, .high)
    }

    func testAHELOCReadsItsCombinedLTVAgainstEightyPercent() throws {
        let figures = try record(["loanType": "heloc", "ltvPct": 62.5, "dtiPct": 31.0, "approvalLikelihood": "Medium"]).figures

        XCTAssertEqual(figures.ltv, LoanFigures.Tile(title: "Combined LTV", value: "62.5%", note: "limit 80%"))
        XCTAssertEqual(figures.likelihood, .medium)
    }

    func testAFigureJustUnderTheLimitIsNotShownAtTheLimit() throws {
        let figures = try record(["loanType": "mortgage", "purchaseLtvPct": 89.96, "dtiPct": 30]).figures

        XCTAssertEqual(figures.ltv.value, "89.9%", "never rounded up to the 90% limit")
        XCTAssertEqual(figures.dti.value, "30.0%")
    }

    func testEveryLikelihoodLabelIsRead() throws {
        for (label, likelihood) in [("High", ApprovalLikelihood.high), ("Medium", .medium), ("Low", .low), ("Unknown", .unknown)] {
            XCTAssertEqual(try record(["approvalLikelihood": label]).figures.likelihood, likelihood, label)
        }
    }

    func testBeforeTheAIReviewTheFiguresAreNotThereYet() throws {
        let figures = try record([:]).figures

        XCTAssertEqual(figures.ltv.value, "—")
        XCTAssertEqual(figures.dti.value, "—")
        XCTAssertEqual(figures.likelihood, .unknown, "Unknown before the first run, as agreed")
        XCTAssertFalse(figures.hasAny)
    }

    func testAPercentageForLikelihoodIsNeverShown() throws {
        // An old internal number on the record must not turn into a label.
        let figures = try record(["approvalLikelihoodPct": 82.0]).figures

        XCTAssertEqual(figures.likelihood, .unknown)
        XCTAssertEqual(ApprovalLikelihood.allCases.map(\.label), ["High", "Medium", "Low", "Unknown"])
    }

    // MARK: - Criterion 2: a one-line explanation each, likelihood "indicative"

    func testLikelihoodIsLabelledIndicativeInItsTone() {
        XCTAssertEqual(LoanFigures.likelihoodNote, "indicative")
        XCTAssertEqual(ApprovalLikelihood.high.tone, .success)
        XCTAssertEqual(ApprovalLikelihood.medium.tone, .tint)
        XCTAssertEqual(ApprovalLikelihood.low.tone, .danger)
        XCTAssertEqual(ApprovalLikelihood.unknown.tone, .neutral)
    }

    func testEachFigureHasAPlainExplanation() throws {
        let purchase = try record(["loanType": "mortgage"]).figures
        let heloc = try record(["loanType": "heloc"]).figures

        XCTAssertEqual(purchase.explanations.map(\.title), ["LTV", "DTI", "Approval likelihood"])
        XCTAssertEqual(purchase.explanations[0].text, "Your loan as a share of the property price. Buyers can borrow up to 90% of the price.")
        XCTAssertEqual(heloc.explanations[0].text, "What you still owe plus the credit line, as a share of your home's estimated value. Up to 80%.")
        XCTAssertEqual(purchase.explanations[1].text, "Your monthly debts, including this loan, as a share of your monthly income before tax.")
        XCTAssertEqual(purchase.explanations[2].text, "Indicative: High, Medium, Low or Unknown, worked out from your application's figures. It isn't a decision. Unknown means some details are missing.")
    }
}
