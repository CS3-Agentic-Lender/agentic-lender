import XCTest

/// AL-250: a euro amount field regroups its thousands as you type, including after a deletion.
final class EuroAmountFieldUITests: EndToEndTestCase {
    private let deleteKey = XCUIKeyboardKey.delete.rawValue

    func testDeletingADigitRegroupsTheAmount() throws {
        try signIn()
        tap("home.affordability")
        tap("loanType.mortgage")

        type("2100000", into: "affordability.income")
        XCTAssertEqual(value(of: "affordability.income"), "2,100,000")

        element("affordability.income").typeText(deleteKey)
        XCTAssertEqual(value(of: "affordability.income"), "210,000", "regrouped after the deletion")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Income after deleting a digit"
        shot.lifetime = .keepAlways
        add(shot)

        element("affordability.income").typeText("5")
        XCTAssertEqual(value(of: "affordability.income"), "2,100,005", "and after typing again")

        // The application form's loan amount, the case in the bug report.
        type("0", into: "affordability.monthlyDebts")
        type("40000", into: "affordability.deposit")
        tap("affordability.calculate")
        tap("affordabilityResult.startApplication")
        type("2100000", into: "application.loanAmount")
        element("application.loanAmount").typeText(deleteKey)
        XCTAssertEqual(value(of: "application.loanAmount"), "210,000")
    }

    private func value(of identifier: String) -> String? {
        element(identifier).value as? String
    }
}
