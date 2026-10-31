import XCTest

/// AL-280 test 3: save a property check and pick it in the application form.
final class SavedCheckUITests: EndToEndTestCase {
    func testASavedCheckFillsTheApplicationsHome() throws {
        try signIn()

        // Home → Check a property, with no checks saved yet.
        tap("home.propertyCheck")
        tap("properties.checkEmpty")
        chooseCounty("Cork", with: "propertyCheck.county")
        type("T12X8Y2", into: "propertyCheck.eircode")
        type("98", into: "propertyCheck.floorArea")
        choose("Semi-detached", in: "propertyCheck.propertyType")
        choose("B2", in: "propertyCheck.berRating")
        type("300000", into: "propertyCheck.askingPrice")
        tap("propertyCheck.check")
        tap("valuationResult.save")
        waitFor("valuationResult.saved")
        goBackToHome()

        openMortgageApplication()
        tap("application.useSavedProperty")
        let row = app.cells.firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: Self.timeout), "The saved check isn't in the sheet")
        row.tap()

        XCTAssertEqual(waitFor("application.eircode").value as? String, "T12 X8Y2")
        XCTAssertEqual(waitFor("application.askingPrice").value as? String, "300,000")
        XCTAssertEqual(waitFor("application.floorArea").value as? String, "98")
    }
}
