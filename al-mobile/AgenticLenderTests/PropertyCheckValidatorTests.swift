import XCTest
@testable import AgenticLender

/// The property check form's checks (AL-143, Figma 10 and 10a Errors).
final class PropertyCheckValidatorTests: XCTestCase {
    private func validForm() -> PropertyCheckForm {
        PropertyCheckForm(
            county: .cork,
            eircode: "T12 X8Y2",
            floorArea: "110",
            bedrooms: 3,
            propertyType: .semiDetached,
            berRating: .b3,
            askingPrice: "379,000"
        )
    }

    func testValidFormHasNoErrors() {
        XCTAssertEqual(PropertyCheckValidator.errors(for: validForm()), [:])
    }

    func testDefaultsAreThreeBedroomsAndNothingElseChosen() {
        let form = PropertyCheckForm()

        XCTAssertNil(form.county)
        XCTAssertNil(form.propertyType)
        XCTAssertNil(form.berRating)
        XCTAssertEqual(form.bedrooms, 3)
        XCTAssertEqual(form.askingPrice, "")
    }

    func testEmptyFormAsksForEveryRequiredFieldButNotTheAskingPrice() {
        let errors = PropertyCheckValidator.errors(for: PropertyCheckForm())

        XCTAssertEqual(errors[.county], "Choose a county")
        XCTAssertEqual(errors[.eircode], "Enter the Eircode")
        XCTAssertEqual(errors[.floorArea], "Enter the size in m²")
        XCTAssertEqual(errors[.propertyType], "Choose a property type")
        XCTAssertEqual(errors[.berRating], "Choose a BER rating")
        XCTAssertNil(errors[.askingPrice])
    }

    // MARK: - Eircode

    func testEircodeUsesTheSameRuleAsTheApplicationForm() {
        for text in ["T12X8Y2", "t12 x8y2", "D6W 1234"] {
            var form = validForm()
            form.eircode = text

            XCTAssertNil(PropertyCheckValidator.errors(for: form)[.eircode], "eircode \(text)")
        }
        for text in ["T12", "B12 X8Y2", "12345678"] {
            var form = validForm()
            form.eircode = text

            XCTAssertEqual(PropertyCheckValidator.errors(for: form)[.eircode], "Enter an Eircode like A65 F4E2", "eircode \(text)")
        }
    }

    // MARK: - Size

    /// The application's limits, so every check can be saved and can fill an application (al-core saved checks).
    /// The model still warns outside 15 to 1,000 m².
    func testSizeMustBeWholeSquareMetresFromOneToTenThousand() {
        for text in ["0", "-20", "10,001", "85.5", "big"] {
            var form = validForm()
            form.floorArea = text

            XCTAssertEqual(
                PropertyCheckValidator.errors(for: form)[.floorArea],
                "Enter a size in whole m², from 1 to 10,000",
                "size \(text)"
            )
        }
    }

    func testSizeAcceptsSmallAndLargeHomesTheModelWillWarnAbout() {
        for text in ["1", "12", "4,500", "10,000"] {
            var form = validForm()
            form.floorArea = text

            XCTAssertNil(PropertyCheckValidator.errors(for: form)[.floorArea], "size \(text)")
        }
    }

    // MARK: - Bedrooms

    func testBedroomsFromZeroToTwentyAreAccepted() {
        for count in [0, 20] {
            var form = validForm()
            form.bedrooms = count

            XCTAssertNil(PropertyCheckValidator.errors(for: form)[.bedrooms], "bedrooms \(count)")
        }
    }

    func testBedroomsOutsideZeroToTwentyAreRejected() {
        for count in [-1, 21] {
            var form = validForm()
            form.bedrooms = count

            XCTAssertEqual(PropertyCheckValidator.errors(for: form)[.bedrooms], "Choose from 0 to 20 bedrooms", "bedrooms \(count)")
        }
    }

    // MARK: - Asking price

    func testAnEmptyAskingPriceIsFine() {
        var form = validForm()
        form.askingPrice = "  "

        XCTAssertNil(PropertyCheckValidator.errors(for: form)[.askingPrice])
    }

    func testAnAskingPriceMustBeWholeEuroAboveZero() {
        for text in ["0", "-5", "379,000.50", "lots", "100,000,001"] {
            var form = validForm()
            form.askingPrice = text

            XCTAssertEqual(
                PropertyCheckValidator.errors(for: form)[.askingPrice],
                "Enter an asking price in whole euro, from €1 to €100,000,000",
                "asking price \(text)"
            )
        }
    }
}
