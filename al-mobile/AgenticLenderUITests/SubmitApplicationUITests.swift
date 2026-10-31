import XCTest

/// AL-280 test 1: sign in, fill and submit a mortgage application, and see its reference.
final class SubmitApplicationUITests: EndToEndTestCase {
    func testSubmittingAMortgageApplicationShowsItsReference() throws {
        try signIn()
        openMortgageApplication()

        type("3650", into: "application.monthlyTakeHome")
        type("1400", into: "application.monthlyLivingCosts")
        type("200000", into: "application.loanAmount")
        type("12 Model Farm Road", into: "application.addressLine1")
        type("T12X8Y2", into: "application.eircode")
        chooseCounty("Cork", with: "application.county")
        type("300000", into: "application.askingPrice")
        choose("Semi-detached", in: "application.propertyType")
        type("98", into: "application.floorArea")
        addBedrooms(3, on: "application.bedrooms")
        choose("B2", in: "application.berRating")

        tap("application.save")
        tap("application.review")
        tap("review.submit")
        let confirm = app.alerts["Submit your application?"].buttons["Submit"]
        XCTAssertTrue(confirm.waitForExistence(timeout: Self.timeout), "The submit confirmation never appeared")
        confirm.tap()

        // VoiceOver reads the reference letter by letter: "Reference e D l W …".
        let reference = waitFor("submitted.reference")
        XCTAssertTrue(reference.label.hasPrefix("Reference "), "The reference reads \"\(reference.label)\"")
    }
}
