import XCTest
@testable import AgenticLender

@MainActor
final class AffordabilityViewModelTests: XCTestCase {
    private func fill(_ model: AffordabilityViewModel) {
        model.form.income = "60,000"
        model.form.monthlyDebts = "250"
        model.form.deposit = "30,000"
    }

    func testCalculateIsDisabledUntilTheFormIsValid() {
        let model = AffordabilityViewModel()
        XCTAssertFalse(model.canCalculate)

        fill(model)

        XCTAssertTrue(model.canCalculate)
    }

    func testNoErrorsShowBeforeAFieldIsLeft() {
        let model = AffordabilityViewModel()

        XCTAssertNil(model.visibleError(for: .income))
    }

    func testErrorShowsOnceTheFieldIsLeft() {
        let model = AffordabilityViewModel()
        model.form.income = "12,000,000"

        model.markTouched(.income)

        XCTAssertEqual(model.visibleError(for: .income), "Enter an amount up to €10,000,000")
    }

    func testTypingRegroupsTheAmount() {
        let model = AffordabilityViewModel()

        model.updateAmount(.income, to: "60000")

        XCTAssertEqual(model.form.income, "60,000")
    }

    func testTermStepsByOneYearWithinFiveToThirtyFive() {
        let model = AffordabilityViewModel()

        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 31)

        model.form.termYears = 35
        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 35)
        XCTAssertFalse(model.canIncreaseTerm)

        model.form.termYears = 5
        model.decreaseTerm()
        XCTAssertEqual(model.form.termYears, 5)
        XCTAssertFalse(model.canDecreaseTerm)
    }

    func testSwitchingToJointNeedsTheSecondIncomeBeforeCalculating() {
        let model = AffordabilityViewModel()
        fill(model)

        model.form.applicants = .joint
        XCTAssertFalse(model.canCalculate)

        model.updateAmount(.secondIncome, to: "45000")
        XCTAssertTrue(model.canCalculate)
    }

    func testCalculateReturnsTheRequestWhenValid() throws {
        let model = AffordabilityViewModel()
        fill(model)

        let request = try XCTUnwrap(model.calculate())

        XCTAssertEqual(request.grossIncome, 60_000)
    }

    func testCalculateWithErrorsShowsThemAndReturnsNothing() {
        let model = AffordabilityViewModel()

        XCTAssertNil(model.calculate())
        XCTAssertEqual(model.visibleError(for: .deposit), "Enter your deposit, or 0 if you have none")
    }
}
