import XCTest

/// AL-282: "Check a property" in the application form opens the check, and Back after saving it
/// returns to the form with what was typed and the new check ready to pick.
final class CheckPropertyFromApplicationUITests: EndToEndTestCase {
    func testCheckingAPropertyFromTheFormComesBackToTheForm() throws {
        try signIn()
        openMortgageApplication()
        type("12 Model Farm Road", into: "application.addressLine1")

        // No checks saved yet, so the form offers "Check a property".
        tap("application.checkProperty")
        chooseCounty("Cork", with: "propertyCheck.county")
        type("T12X8Y2", into: "propertyCheck.eircode")
        type("98", into: "propertyCheck.floorArea")
        choose("Semi-detached", in: "propertyCheck.propertyType")
        choose("B2", in: "propertyCheck.berRating")
        tap("propertyCheck.check")
        tap("valuationResult.save")
        waitFor("valuationResult.saved")

        // Back past the result and the check.
        for _ in 0..<2 {
            app.navigationBars.buttons["BackButton"].firstMatch.tap()
        }
        XCTAssertEqual(waitFor("application.addressLine1").value as? String, "12 Model Farm Road")
        waitFor("application.useSavedProperty")
    }
}
