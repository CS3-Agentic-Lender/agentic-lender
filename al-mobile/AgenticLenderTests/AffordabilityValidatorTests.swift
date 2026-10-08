import XCTest
@testable import AgenticLender

final class AffordabilityValidatorTests: XCTestCase {
    private func validForm() -> AffordabilityForm {
        AffordabilityForm(
            applicants: .single,
            income: "60,000",
            secondIncome: "",
            monthlyDebts: "250",
            deposit: "30,000",
            termYears: 30,
            isFirstTimeBuyer: true
        )
    }

    func testValidSingleFormHasNoErrors() {
        XCTAssertEqual(AffordabilityValidator.errors(for: validForm()), [:])
    }

    func testDefaultsAreSingleThirtyYearsFirstTimeBuyer() {
        let form = AffordabilityForm()

        XCTAssertEqual(form.applicants, .single)
        XCTAssertEqual(form.termYears, 30)
        XCTAssertTrue(form.isFirstTimeBuyer)
    }

    // MARK: - Required amounts

    func testEmptyAmountsAskForAValue() {
        let errors = AffordabilityValidator.errors(for: AffordabilityForm())

        XCTAssertEqual(errors[.income], "Enter your gross yearly income")
        XCTAssertEqual(errors[.monthlyDebts], "Enter your monthly debts, or 0 if you have none")
        XCTAssertEqual(errors[.deposit], "Enter your deposit, or 0 if you have none")
    }

    func testZeroIsAllowedForEveryAmount() {
        var form = validForm()
        form.income = "0"
        form.monthlyDebts = "0"
        form.deposit = "0"

        XCTAssertEqual(AffordabilityValidator.errors(for: form), [:])
    }

    func testNegativeOrNonNumericAmountsAreRejected() {
        var form = validForm()
        form.monthlyDebts = "-5"
        form.deposit = "12.50"

        let errors = AffordabilityValidator.errors(for: form)
        XCTAssertEqual(errors[.monthlyDebts], "Enter an amount of €0 or more, in whole euro")
        XCTAssertEqual(errors[.deposit], "Enter an amount of €0 or more, in whole euro")
    }

    // MARK: - Income limit

    func testIncomeOfExactlyTenMillionIsAllowed() {
        var form = validForm()
        form.income = "10,000,000"

        XCTAssertNil(AffordabilityValidator.errors(for: form)[.income])
    }

    func testIncomeAboveTenMillionIsRejected() {
        var form = validForm()
        form.income = "10,000,001"

        XCTAssertEqual(AffordabilityValidator.errors(for: form)[.income], "Enter an amount up to €10,000,000")
    }

    // MARK: - Joint

    func testJointNeedsTheSecondApplicantsIncome() {
        var form = validForm()
        form.applicants = .joint

        XCTAssertEqual(
            AffordabilityValidator.errors(for: form)[.secondIncome],
            "Enter the second applicant's gross yearly income"
        )
    }

    func testSecondIncomeHasTheSameLimit() {
        var form = validForm()
        form.applicants = .joint
        form.secondIncome = "12,000,000"

        XCTAssertEqual(AffordabilityValidator.errors(for: form)[.secondIncome], "Enter an amount up to €10,000,000")
    }

    func testSingleIgnoresAnySecondIncome() {
        var form = validForm()
        form.secondIncome = "nonsense"

        XCTAssertNil(AffordabilityValidator.errors(for: form)[.secondIncome])
    }

    // MARK: - Term

    func testTermBoundariesFiveAndThirtyFiveAreAllowed() {
        for years in [5, 35] {
            var form = validForm()
            form.termYears = years
            XCTAssertNil(AffordabilityValidator.errors(for: form)[.term], "\(years)")
        }
    }

    func testTermOutsideFiveToThirtyFiveIsRejected() {
        for years in [4, 36] {
            var form = validForm()
            form.termYears = years
            XCTAssertEqual(
                AffordabilityValidator.errors(for: form)[.term],
                "Choose a term from 5 to 35 years",
                "\(years)"
            )
        }
    }

    // MARK: - Request

    func testBuildsTheRequestInWholeEuro() throws {
        var form = validForm()
        form.applicants = .joint
        form.secondIncome = "45,000"

        let request = try XCTUnwrap(AffordabilityRequest(form: form))

        XCTAssertTrue(request.isJoint)
        XCTAssertEqual(request.grossIncome, 60_000)
        XCTAssertEqual(request.secondGrossIncome, 45_000)
        XCTAssertEqual(request.monthlyDebts, 250)
        XCTAssertEqual(request.deposit, 30_000)
        XCTAssertEqual(request.termYears, 30)
        XCTAssertTrue(request.isFirstTimeBuyer)
    }

    func testSingleRequestHasNoSecondIncome() throws {
        let request = try XCTUnwrap(AffordabilityRequest(form: validForm()))

        XCTAssertFalse(request.isJoint)
        XCTAssertNil(request.secondGrossIncome)
    }

    func testNoRequestFromAnInvalidForm() {
        XCTAssertNil(AffordabilityRequest(form: AffordabilityForm()))
    }
}
