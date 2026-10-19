import XCTest
@testable import AgenticLender

final class ApplicationValidatorTests: XCTestCase {
    private func validForm() -> ApplicationForm {
        TestFixtures.filledApplicationForm()
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

    // MARK: - Property

    func testEveryPropertyFieldIsRequiredExceptAddressLine2() {
        let errors = ApplicationValidator.errors(for: TestFixtures.applicationForm())

        XCTAssertEqual(errors[.addressLine1], "Enter the first line of the address")
        XCTAssertEqual(errors[.eircode], "Enter the Eircode")
        XCTAssertEqual(errors[.county], "Choose the county")
        XCTAssertEqual(errors[.askingPrice], "Enter the asking price")
        XCTAssertEqual(errors[.propertyType], "Choose the property type")
        XCTAssertEqual(errors[.floorArea], "Enter the floor area in m²")
        XCTAssertEqual(errors[.berRating], "Choose the BER rating")
    }

    func testEircodeMustBeAValidEircode() {
        var form = validForm()
        form.property.eircode = "T12 X8Y"

        XCTAssertEqual(ApplicationValidator.errors(for: form)[.eircode], "Enter an Eircode like A65 F4E2")
    }

    func testAskingPriceMustBeWholeEuroAboveZero() {
        for price in ["0", "-5", "380,000.50", "abc"] {
            var form = validForm()
            form.property.askingPrice = price

            XCTAssertEqual(
                ApplicationValidator.errors(for: form)[.askingPrice],
                "Enter an asking price above €0, in whole euro",
                "for \(price)"
            )
        }
    }

    func testFloorAreaMustBeWholeSquareMetresAboveZeroUpToTenThousand() {
        for area in ["0", "-1", "98.5", "10,001"] {
            var form = validForm()
            form.property.floorArea = area

            XCTAssertEqual(
                ApplicationValidator.errors(for: form)[.floorArea],
                "Enter the floor area in whole m², from 1 to 10,000",
                "for \(area)"
            )
        }
    }

    func testFloorAreaOfTenThousandIsAllowed() {
        var form = validForm()
        form.property.floorArea = "10,000"

        XCTAssertNil(ApplicationValidator.errors(for: form)[.floorArea])
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
        form.property = TestFixtures.exampleProperty()

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
        XCTAssertNotNil(body["property"])
        XCTAssertEqual(body.count, 13)
    }

    func testDraftBodyCarriesThePropertyWithTheEircodeInCapitalsWithASpace() throws {
        let draft = try XCTUnwrap(ApplicationDraft(form: TestFixtures.filledApplicationForm()))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        let property = try XCTUnwrap(body["property"] as? [String: Any])

        XCTAssertEqual(property["address_line_1"] as? String, "12 Model Farm Road")
        XCTAssertEqual(property["eircode"] as? String, "T12 X8Y2")
        XCTAssertEqual(property["county"] as? String, "Cork")
        XCTAssertEqual(property["asking_price_eur"] as? Int, 380_000)
        XCTAssertEqual(property["property_type"] as? String, "Semi-D")
        XCTAssertEqual(property["bedrooms"] as? Int, 3)
        XCTAssertEqual(property["floor_area_sqm"] as? Int, 98)
        XCTAssertEqual(property["ber_rating"] as? String, "C2")
        XCTAssertNil(property["address_line_2"], "an empty second line is left out")
        XCTAssertEqual(property.count, 8)
    }

    func testDraftBodySendsASecondAddressLineWhenThereIsOne() throws {
        var form = TestFixtures.filledApplicationForm()
        form.property.addressLine2 = "  Bishopstown  "
        let draft = try XCTUnwrap(ApplicationDraft(form: form))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        let property = try XCTUnwrap(body["property"] as? [String: Any])

        XCTAssertEqual(property["address_line_2"] as? String, "Bishopstown")
    }
}
