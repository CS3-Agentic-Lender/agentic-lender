import XCTest
@testable import AgenticLender

@MainActor
final class ApplicationViewModelTests: XCTestCase {
    func testSummarisesTheAffordabilityAnswers() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm())

        XCTAssertEqual(model.affordabilitySummary, "Single · €60,000 income · €0 debts · €40,000 deposit")
    }

    func testJointSummaryShowsTheHouseholdIncome() {
        let model = ApplicationViewModel(
            form: ApplicationForm(affordability: TestFixtures.jointAffordabilityRequest(), maxLoanEur: 270_000)
        )

        XCTAssertEqual(model.affordabilitySummary, "Joint · €90,000 income · €0 debts · €30,000 deposit")
    }

    func testNoErrorsShowBeforeAFieldIsLeft() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm())

        XCTAssertNil(model.visibleError(for: .monthlyTakeHome))
    }

    func testErrorShowsOnceTheFieldIsLeft() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm())

        model.markTouched(.monthlyTakeHome)

        XCTAssertEqual(model.visibleError(for: .monthlyTakeHome), "Enter your monthly take-home pay")
    }

    func testTypingRegroupsTheAmount() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm())

        model.updateAmount(.loanAmount, to: "260000")

        XCTAssertEqual(model.form.loanAmount, "260,000")
    }

    func testWarningShowsAsSoonAsTheLoanIsAboveTheMaximum() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm())

        model.updateAmount(.loanAmount, to: "260000")

        XCTAssertEqual(model.loanWarning, "This is above the €240,000 you could borrow. Your broker may ask you to lower it.")
    }

    func testTermStepsWithinFiveToThirtyFiveYears() {
        var form = TestFixtures.applicationForm()
        form.termYears = 35
        let model = ApplicationViewModel(form: form)

        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 35)
        XCTAssertFalse(model.canIncreaseTerm)

        model.decreaseTerm()
        XCTAssertEqual(model.form.termYears, 34)
    }

    func testYearsInCurrentJobStaysWithinRange() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm())

        model.decreaseYearsInJob()
        XCTAssertEqual(model.form.yearsInCurrentJob, 0)
        XCTAssertFalse(model.canDecreaseYearsInJob)

        model.increaseYearsInJob()
        XCTAssertEqual(model.form.yearsInCurrentJob, 1)
    }
}
