import XCTest
@testable import AgenticLender

final class ApplicationValidatorTests: XCTestCase {
    private func validForm() -> ApplicationForm {
        var form = TestFixtures.applicationForm()
        form.loanAmount = "210,000"
        form.monthlyTakeHome = "3,650"
        form.monthlyLivingCosts = "1,400"
        return form
    }

    func testValidFormHasNoErrors() {
        XCTAssertEqual(ApplicationValidator.errors(for: validForm()), [:])
    }

    func testStartsFromTheAffordabilityCheck() {
        let form = TestFixtures.applicationForm()

        XCTAssertEqual(form.termYears, 30)
        XCTAssertEqual(form.employment, .employed)
        XCTAssertEqual(form.yearsInCurrentJob, 0)
    }

    // MARK: - Take-home pay and living costs

    func testTakeHomePayAndLivingCostsAreRequired() {
        let errors = ApplicationValidator.errors(for: TestFixtures.applicationForm())

        XCTAssertEqual(errors[.monthlyTakeHome], "Enter your monthly take-home pay")
        XCTAssertEqual(errors[.monthlyLivingCosts], "Enter your monthly living costs")
    }

    func testTakeHomePayAndLivingCostsCanBeZero() {
        var form = validForm()
        form.monthlyTakeHome = "0"
        form.monthlyLivingCosts = "0"

        XCTAssertEqual(ApplicationValidator.errors(for: form), [:])
    }

    func testNegativeOrNonWholeAmountsAreRejected() {
        var form = validForm()
        form.monthlyTakeHome = "-1"
        form.monthlyLivingCosts = "1,400.50"

        let errors = ApplicationValidator.errors(for: form)
        XCTAssertEqual(errors[.monthlyTakeHome], "Enter an amount of €0 or more, in whole euro")
        XCTAssertEqual(errors[.monthlyLivingCosts], "Enter an amount of €0 or more, in whole euro")
    }

    // MARK: - Loan amount

    func testLoanAmountIsRequired() {
        var form = validForm()
        form.loanAmount = ""

        XCTAssertEqual(ApplicationValidator.errors(for: form)[.loanAmount], "Enter the amount you want to borrow")
    }

    func testLoanAmountMustBeAboveZero() {
        var form = validForm()
        form.loanAmount = "0"

        XCTAssertEqual(ApplicationValidator.errors(for: form)[.loanAmount], "Enter a loan amount above €0, in whole euro")
    }

    func testLoanAboveTheMaximumIsAWarningNotAnError() {
        var form = validForm()
        form.loanAmount = "260,000"

        XCTAssertNil(ApplicationValidator.errors(for: form)[.loanAmount])
        XCTAssertEqual(
            ApplicationValidator.loanWarning(for: form),
            "This is above the €240,000 you could borrow. Your broker may ask you to lower it."
        )
    }

    func testLoanAtOrBelowTheMaximumHasNoWarning() {
        var form = validForm()
        form.loanAmount = "240,000"

        XCTAssertNil(ApplicationValidator.loanWarning(for: form))
    }

    func testNoWarningWhileTheLoanAmountIsInvalid() {
        var form = validForm()
        form.loanAmount = "lots"

        XCTAssertNil(ApplicationValidator.loanWarning(for: form))
    }

    // MARK: - Draft

    func testDraftUsesTheAgreedSchemaValues() throws {
        var form = validForm()
        form.employment = .selfEmployed
        form.yearsInCurrentJob = 4

        let draft = try XCTUnwrap(ApplicationDraft(form: form))

        XCTAssertEqual(draft.applicants, "single")
        XCTAssertEqual(draft.grossIncomeEur, 60_000)
        XCTAssertEqual(draft.monthlyDebtsEur, 0)
        XCTAssertEqual(draft.depositEur, 40_000)
        XCTAssertTrue(draft.firstTimeBuyer)
        XCTAssertEqual(draft.termYears, 30)
        XCTAssertEqual(draft.loanAmountEur, 210_000)
        XCTAssertEqual(draft.employmentType, "self_employed")
        XCTAssertEqual(draft.yearsInCurrentJob, 4)
        XCTAssertEqual(draft.monthlyTakeHomeEur, 3_650)
        XCTAssertEqual(draft.monthlyLivingCostsEur, 1_400)
    }

    func testJointDraftCarriesTheHouseholdIncome() throws {
        var form = ApplicationForm(affordability: TestFixtures.jointAffordabilityRequest(), maxLoanEur: 270_000)
        form.loanAmount = "270,000"
        form.monthlyTakeHome = "5,200"
        form.monthlyLivingCosts = "2,000"

        let draft = try XCTUnwrap(ApplicationDraft(form: form))

        XCTAssertEqual(draft.applicants, "joint")
        XCTAssertEqual(draft.grossIncomeEur, 90_000)
    }

    func testNoDraftFromAnInvalidForm() {
        XCTAssertNil(ApplicationDraft(form: TestFixtures.applicationForm()))
    }

    func testDraftBodyIsAMortgageInTheAPIFieldNames() throws {
        let draft = try XCTUnwrap(ApplicationDraft(form: TestFixtures.filledApplicationForm()))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])

        XCTAssertEqual(body["loan_type"] as? String, "mortgage")
        XCTAssertEqual(body["applicants"] as? String, "single")
        XCTAssertEqual(body["gross_income_eur"] as? Int, 60_000)
        XCTAssertEqual(body["monthly_debts_eur"] as? Int, 0)
        XCTAssertEqual(body["deposit_eur"] as? Int, 40_000)
        XCTAssertEqual(body["first_time_buyer"] as? Bool, true)
        XCTAssertEqual(body["term_years"] as? Int, 30)
        XCTAssertEqual(body["loan_amount_eur"] as? Int, 210_000)
        XCTAssertEqual(body["employment_type"] as? String, "employed")
        XCTAssertEqual(body["years_in_current_job"] as? Int, 0)
        XCTAssertEqual(body["monthly_take_home_eur"] as? Int, 3_650)
        XCTAssertEqual(body["monthly_living_costs_eur"] as? Int, 1_400)
        XCTAssertNil(body["property"], "the property waits on the team's Sprint 1 decision")
        XCTAssertEqual(body.count, 12)
    }

    func testDraftBodyCarriesTheChosenLoanType() throws {
        let filled = TestFixtures.filledApplicationForm()
        var form = ApplicationForm(affordability: filled.affordability, maxLoanEur: filled.maxLoanEur, loanType: .heloc)
        form.loanAmount = filled.loanAmount
        form.monthlyTakeHome = filled.monthlyTakeHome
        form.monthlyLivingCosts = filled.monthlyLivingCosts
        let draft = try XCTUnwrap(ApplicationDraft(form: form))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])

        XCTAssertEqual(body["loan_type"] as? String, "heloc")
    }
}
