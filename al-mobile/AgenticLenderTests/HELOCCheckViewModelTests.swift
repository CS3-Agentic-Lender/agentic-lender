import XCTest
@testable import AgenticLender

/// When the HELOC check form shows its errors, and its two steppers (AL-207).
@MainActor
final class HELOCCheckViewModelTests: XCTestCase {
    func testNoErrorShowsBeforeAFieldIsLeft() {
        let model = HELOCCheckViewModel()

        XCTAssertNil(model.visibleError(for: .mortgageBalance))
    }

    func testAnErrorShowsOnceItsFieldIsLeft() {
        let model = HELOCCheckViewModel()

        model.markTouched(.mortgageBalance)

        XCTAssertEqual(model.visibleError(for: .mortgageBalance), "Enter what's left on your mortgage, or 0 if it's paid off")
        XCTAssertNil(model.visibleError(for: .income))
    }

    func testAmountsAreRegroupedWhileTyping() {
        let model = HELOCCheckViewModel()

        model.updateText(.mortgageBalance, to: "150000")
        model.updateText(.income, to: "70000")
        model.updateText(.monthlyDebts, to: "300")
        model.updateText(.floorArea, to: "1200")

        XCTAssertEqual(model.form.mortgageBalance, "150,000")
        XCTAssertEqual(model.form.income, "70,000")
        XCTAssertEqual(model.form.monthlyDebts, "300")
        XCTAssertEqual(model.form.floorArea, "1,200")
    }

    func testIsCompleteOnlyWhenEveryFieldIsValid() {
        let model = HELOCCheckViewModel()
        XCTAssertFalse(model.isComplete)

        model.form = HELOCCheckForm(
            county: .cork, floorArea: "110", bedrooms: 3, berRating: .b3,
            mortgageBalance: "150,000", income: "70,000", monthlyDebts: "300", termYears: 20
        )

        XCTAssertTrue(model.isComplete)
    }

    // MARK: - Bedrooms

    func testBedroomsGoDownToZeroAndNoFurther() {
        let model = HELOCCheckViewModel()
        model.form.bedrooms = 1

        model.decreaseBedrooms()
        XCTAssertEqual(model.form.bedrooms, 0)
        XCTAssertFalse(model.canDecreaseBedrooms)

        model.decreaseBedrooms()
        XCTAssertEqual(model.form.bedrooms, 0)
    }

    func testBedroomsGoUp() {
        let model = HELOCCheckViewModel()

        model.increaseBedrooms()

        XCTAssertEqual(model.form.bedrooms, 4)
    }

    // MARK: - Term

    func testTermStaysWithinFiveToThirtyFiveYears() {
        let model = HELOCCheckViewModel()

        model.form.termYears = 35
        XCTAssertFalse(model.canIncreaseTerm)
        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 35)

        model.form.termYears = 5
        XCTAssertFalse(model.canDecreaseTerm)
        model.decreaseTerm()
        XCTAssertEqual(model.form.termYears, 5)
    }
}
