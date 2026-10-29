import XCTest
@testable import AgenticLender

/// Picking a saved check in the application form fills the home's details (AL-144 criterion 3).
final class ApplicationPropertyFillTests: XCTestCase {
    func testASavedCheckFillsEverythingButTheAddress() {
        var typed = ApplicationProperty()
        typed.addressLine1 = "12 Model Farm Road"
        typed.addressLine2 = "Bishopstown"

        let filled = typed.filled(from: SavedCheckFixtures.check())

        XCTAssertEqual(filled.addressLine1, "12 Model Farm Road")
        XCTAssertEqual(filled.addressLine2, "Bishopstown")
        XCTAssertEqual(filled.eircode, "T12 X8Y2")
        XCTAssertEqual(filled.county, .cork)
        XCTAssertEqual(filled.propertyType, .semiDetached)
        XCTAssertEqual(filled.bedrooms, 3)
        XCTAssertEqual(filled.floorArea, "110")
        XCTAssertEqual(filled.berRating, .b3)
        XCTAssertEqual(filled.askingPrice, "379,000")
    }

    func testACheckWithNoAskingPriceKeepsTheOneTheBorrowerTyped() {
        var typed = ApplicationProperty()
        typed.askingPrice = "380,000"

        let filled = typed.filled(from: SavedCheckFixtures.check(askingPrice: nil))

        XCTAssertEqual(filled.askingPrice, "380,000")
    }

    func testTheOriginalIsLeftAsItWas() {
        let typed = ApplicationProperty()

        _ = typed.filled(from: SavedCheckFixtures.check())

        XCTAssertEqual(typed, ApplicationProperty())
    }

    func testAFilledPropertyIsReadyToSend() {
        var typed = ApplicationProperty()
        typed.addressLine1 = "12 Model Farm Road"

        XCTAssertNotNil(PropertyDraft(property: typed.filled(from: SavedCheckFixtures.check())))
    }
}
