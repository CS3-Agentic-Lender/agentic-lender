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

    func testAFigureJustOverTheLimitIsNotShownAtTheLimit() throws {
        let purchase = try record(["loanType": "mortgage", "purchaseLtvPct": 90.04]).figures
        let heloc = try record(["loanType": "heloc", "ltvPct": 80.01]).figures

        XCTAssertEqual(purchase.ltv.value, "90.1%", "never rounded down to the 90% limit")
        XCTAssertEqual(heloc.ltv.value, "80.1%", "never rounded down to the 80% limit")
    }

    func testAFigureExactlyAtTheLimitIsShownAtTheLimit() throws {
        XCTAssertEqual(try record(["loanType": "mortgage", "purchaseLtvPct": 90]).figures.ltv.value, "90.0%")
        XCTAssertEqual(try record(["loanType": "heloc", "ltvPct": 80]).figures.ltv.value, "80.0%")
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
        let purchase = try record(["loanType": "mortgage", "approvalLikelihood": "High"]).figures
        let heloc = try record(["loanType": "heloc", "approvalLikelihood": "Medium"]).figures

        XCTAssertEqual(purchase.explanations.map(\.title), ["LTV", "DTI", "Approval likelihood"])
        XCTAssertEqual(purchase.explanations[0].text, "Your loan as a share of the property price.")
        XCTAssertEqual(heloc.explanations[0].text, "What you still owe plus the credit line, as a share of your home's estimated value.")
        XCTAssertEqual(purchase.explanations[1].text, "Your monthly debts, including this loan, as a share of your monthly income before tax.")
        XCTAssertEqual(
            purchase.explanations[2].text,
            "An indicative guide to how likely approval looks from your application's figures, not a decision."
        )
    }

    func testAnUnknownLikelihoodSaysWhyThereIsNoEstimate() throws {
        let figures = try record(["loanType": "heloc"]).figures

        XCTAssertEqual(figures.likelihood, .unknown)
        XCTAssertEqual(figures.explanations[2].text, "We can't estimate this yet: either some details are missing or your home's valuation isn't ready.")
    }

    func testEveryExplanationIsOneSentence() throws {
        let sentenceEnds: Set<Character> = [".", "!", "?"]

        for loanType in ["mortgage", "heloc"] {
            for likelihood in ApprovalLikelihood.allCases {
                let figures = try record(["loanType": loanType, "approvalLikelihood": likelihood.rawValue]).figures

                for explanation in figures.explanations {
                    let ends = explanation.text.filter(sentenceEnds.contains)
                    XCTAssertEqual(ends, ".", "\(explanation.title) (\(loanType), \(likelihood.label)): \(explanation.text)")
                    XCTAssertTrue(explanation.text.hasSuffix("."), explanation.text)
                    XCTAssertFalse(explanation.text.contains(";") || explanation.text.contains("\n"), explanation.text)
                }
            }
        }
    }

    func testTheLimitStaysOnTheTileNotInTheExplanation() throws {
        let purchase = try record(["loanType": "mortgage"]).figures
        let heloc = try record(["loanType": "heloc"]).figures

        XCTAssertEqual(purchase.ltv.note, "limit 90%")
        XCTAssertEqual(heloc.ltv.note, "limit 80%")
        XCTAssertFalse(purchase.explanations[0].text.contains("90"))
        XCTAssertFalse(heloc.explanations[0].text.contains("80"))
    }
}
