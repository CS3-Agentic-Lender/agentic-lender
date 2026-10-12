import XCTest
@testable import AgenticLender

/// The mortgage-or-HELOC choice at the start of the affordability check (AL-206, Figma 07h).
final class LoanTypeTests: XCTestCase {
    func testValuesMatchTheApplicationsSchema() {
        XCTAssertEqual(LoanType.mortgage.rawValue, "mortgage")
        XCTAssertEqual(LoanType.heloc.rawValue, "heloc")
    }

    func testChoiceCardsUseTheFigmaWording() {
        XCTAssertEqual(LoanType.mortgage.title, "Buy a home")
        XCTAssertEqual(LoanType.mortgage.detail, "Mortgage. See how much you can borrow from your income and deposit.")
        XCTAssertEqual(LoanType.heloc.title, "Borrow against my home")
        XCTAssertEqual(
            LoanType.heloc.detail,
            "Home equity line of credit (HELOC). See how much you can borrow against the value of the home you own."
        )
    }

    func testOnlyMortgageIsOfferedUntilTheHELOCCheckExists() {
        XCTAssertEqual(LoanType.available(hasHELOCCheck: false), [.mortgage])
        XCTAssertEqual(LoanType.available(hasHELOCCheck: true), [.mortgage, .heloc])
    }

    func testTheMortgageChoiceIsCarriedIntoTheApplication() throws {
        var form = TestFixtures.applicationForm()
        form.loanAmount = "210,000"
        form.monthlyTakeHome = "3,650"
        form.monthlyLivingCosts = "1,400"

        XCTAssertEqual(form.loanType, .mortgage)
        XCTAssertEqual(try XCTUnwrap(ApplicationDraft(form: form)).loanType, "mortgage")
    }
}
