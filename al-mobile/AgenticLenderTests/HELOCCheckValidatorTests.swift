import XCTest
@testable import AgenticLender

/// The HELOC check form's checks (AL-207, Figma 07i and 07j Error).
final class HELOCCheckValidatorTests: XCTestCase {
    private func validForm() -> HELOCCheckForm {
        HELOCCheckForm(
            county: .cork,
            floorArea: "110",
            bedrooms: 3,
            berRating: .b3,
            mortgageBalance: "150,000",
            income: "70,000",
            monthlyDebts: "300",
            termYears: 20
        )
    }

    func testValidFormHasNoErrors() {
        XCTAssertEqual(HELOCCheckValidator.errors(for: validForm()), [:])
    }

    func testDefaultsAreThreeBedroomsAndTwentyYears() {
        let form = HELOCCheckForm()

        XCTAssertNil(form.county)
        XCTAssertNil(form.berRating)
        XCTAssertEqual(form.bedrooms, 3)
        XCTAssertEqual(form.termYears, 20)
    }

    // MARK: - Empty form

    func testEmptyFormAsksForEveryField() {
        let errors = HELOCCheckValidator.errors(for: HELOCCheckForm())

        XCTAssertEqual(errors[.county], "Choose the county")
        XCTAssertEqual(errors[.floorArea], "Enter the floor area in m²")
        XCTAssertEqual(errors[.berRating], "Choose the BER rating")
        XCTAssertEqual(errors[.mortgageBalance], "Enter what's left on your mortgage, or 0 if it's paid off")
        XCTAssertEqual(errors[.income], "Enter your gross yearly income")
        XCTAssertEqual(errors[.monthlyDebts], "Enter your monthly debts, or 0 if you have none")
        XCTAssertNil(errors[.term])
    }

    // MARK: - Floor area

    func testFloorAreaMustBeAWholeNumberAboveZero() {
        for text in ["0", "-20", "85.5", "big"] {
            var form = validForm()
            form.floorArea = text

            XCTAssertEqual(
                HELOCCheckValidator.errors(for: form)[.floorArea],
                "Enter the floor area in whole m², more than 0",
                "floor area \(text)"
            )
        }
    }

    func testFloorAreaAllowsSpacesAndThousandsSeparators() {
        var form = validForm()
        form.floorArea = " 1,200 "

        XCTAssertNil(HELOCCheckValidator.errors(for: form)[.floorArea])
    }

    // MARK: - Amounts

    func testAPaidOffMortgageIsZeroNotEmpty() {
        var form = validForm()
        form.mortgageBalance = "0"

        XCTAssertNil(HELOCCheckValidator.errors(for: form)[.mortgageBalance])
    }

    func testAmountsMustBeWholeEuroFromZero() {
        var form = validForm()
        form.mortgageBalance = "-1"
        form.monthlyDebts = "12.50"

        let errors = HELOCCheckValidator.errors(for: form)
        XCTAssertEqual(errors[.mortgageBalance], "Enter an amount of €0 or more, in whole euro")
        XCTAssertEqual(errors[.monthlyDebts], "Enter an amount of €0 or more, in whole euro")
    }

    func testIncomeAboveTenMillionIsRejected() {
        var form = validForm()
        form.income = "10,000,001"

        XCTAssertEqual(HELOCCheckValidator.errors(for: form)[.income], "Enter an amount up to €10,000,000")
    }

    // MARK: - Term

    func testTermOutsideFiveToThirtyFiveYearsIsRejected() {
        for years in [4, 36] {
            var form = validForm()
            form.termYears = years

            XCTAssertEqual(
                HELOCCheckValidator.errors(for: form)[.term],
                "Choose a term from 5 to 35 years",
                "term \(years)"
            )
        }
    }
}
