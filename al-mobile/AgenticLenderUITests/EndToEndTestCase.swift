import XCTest

/// The base of the end-to-end tests: a fresh test borrower before each test, deleted after it, and
/// the app launched signed out.
///
/// Needs the local stack running (see "UI tests" in `docs/infrastructure.md`). These tests are not in
/// the `AgenticLender` scheme, so CI, which has no emulators, runs only the unit tests.
@MainActor
class EndToEndTestCase: XCTestCase {
    /// Long enough for a cold gateway call or a valuation, short enough that a hang fails quickly.
    static let timeout: TimeInterval = 20
    /// Matches `UITestLaunch.signOutKey` in the app.
    private static let signOutKey = "AL_UI_TEST_SIGN_OUT"

    private(set) var app = XCUIApplication()
    private(set) var borrower: TestBorrower?

    override func setUp() async throws {
        continueAfterFailure = false
        let borrower = try await TestBorrower.create()
        self.borrower = borrower
        // Not on the main actor: after a failed assertion XCTest runs teardown while it holds the
        // main thread, so a main-actor clean-up would wait forever.
        addTeardownBlock { @Sendable in
            try await borrower.delete()
        }
        app = XCUIApplication()
        app.launchEnvironment[Self.signOutKey] = "1"
        app.launch()
    }

    var testBorrower: TestBorrower {
        get throws { try XCTUnwrap(borrower, "setUp didn't create a test borrower") }
    }

    // MARK: Journeys

    /// Signs in from Welcome with email and password and waits for Home.
    func signIn() throws {
        let borrower = try testBorrower
        tap("welcome.signIn")
        type(borrower.email, into: "signIn.email")
        type(TestBorrower.password, into: "signIn.password")
        tap("signIn.submit")
        dismissSavePasswordPrompt()
        waitFor("home.affordability")
    }

    /// iOS offers to save the password after a sign-in; the prompt covers Home until it's closed.
    private func dismissSavePasswordPrompt() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for owner in [app, springboard] {
            let notNow = owner.buttons["Not Now"].firstMatch
            if notNow.waitForExistence(timeout: 3) {
                notNow.tap()
                return
            }
        }
    }

    /// Home → What can I borrow? → Mortgage → calculate → Start application, ending on the form.
    func openMortgageApplication() {
        tap("home.affordability")
        tap("loanType.mortgage")
        type("60000", into: "affordability.income")
        type("0", into: "affordability.monthlyDebts")
        type("40000", into: "affordability.deposit")
        tap("affordability.calculate")
        tap("affordabilityResult.startApplication")
        waitFor("application.monthlyTakeHome")
    }

    // MARK: Elements

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @discardableResult
    func waitFor(_ identifier: String, timeout: TimeInterval = timeout, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let found = element(identifier)
        XCTAssertTrue(found.waitForExistence(timeout: timeout), "\(identifier) never appeared", file: file, line: line)
        return found
    }

    /// Waits for the element, scrolls it into reach and taps it.
    func tap(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let target = waitFor(identifier, file: file, line: line)
        scrollIntoReach(target)
        liftAboveKeyboard(target)
        target.tap()
    }

    /// Taps the field until it has the keyboard, then types. A tap while the keyboard is still
    /// moving can land without focusing the field.
    func type(_ text: String, into identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let field = waitFor(identifier, file: file, line: line)
        for _ in 0..<Self.focusAttempts where !hasKeyboardFocus(field) {
            scrollIntoReach(field)
            liftAboveKeyboard(field)
            field.tap()
        }
        XCTAssertTrue(hasKeyboardFocus(field), "\(identifier) never got the keyboard", file: file, line: line)
        field.typeText(text)
    }

    private static let focusAttempts = 3
    /// Room above the keyboard for a screen's pinned footer (button, hint, padding).
    private static let footerClearance: CGFloat = 180
    private static let liftDistance: CGFloat = 150
    private static let maxDrags = 4
    private static let maxSwipes = 6

    /// Drags the form up until the field sits above the keyboard and the footer pinned on top of it.
    /// iOS still calls a field under the footer hittable, so a tap there goes to the footer instead.
    private func liftAboveKeyboard(_ field: XCUIElement) {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }
        var drags = 0
        while field.frame.maxY > keyboard.frame.minY - Self.footerClearance && drags < Self.maxDrags {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -Self.liftDistance)))
            drags += 1
        }
    }

    private func hasKeyboardFocus(_ field: XCUIElement) -> Bool {
        (field.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
    }

    /// Taps a menu's button, then the choice titled `choice`.
    func choose(_ choice: String, in identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        tap(identifier, file: file, line: line)
        let option = app.buttons[choice].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: Self.timeout), "\(choice) isn't in \(identifier)", file: file, line: line)
        option.tap()
    }

    /// Picks a county in the county sheet, which `identifier` opens.
    func chooseCounty(_ county: String, with identifier: String) {
        tap(identifier)
        let row = app.buttons[county].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: Self.timeout), "\(county) isn't in the county sheet")
        row.tap()
    }

    /// Taps the + of a bedrooms stepper `times` times. VoiceOver reads the stepper as one element,
    /// so the + is reached by where it sits: the right end of the row under the label.
    func addBedrooms(_ times: Int, on identifier: String) {
        let stepper = waitFor(identifier)
        scrollIntoReach(stepper)
        for _ in 0..<times {
            stepper.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.7)).tap()
        }
    }

    /// Taps Back until Home shows.
    func goBackToHome() {
        let home = element("home.affordability")
        var backs = 0
        while !home.exists && backs < Self.maxBacks {
            app.navigationBars.buttons["BackButton"].firstMatch.tap()
            backs += 1
            _ = home.waitForExistence(timeout: 2)
        }
        XCTAssertTrue(home.exists, "Home didn't show after \(backs) taps on Back")
    }

    private static let maxBacks = 5

    /// Swipes the screen up until the element can be tapped. The keyboard and the pinned footer
    /// buttons can cover fields low on a form.
    private func scrollIntoReach(_ target: XCUIElement) {
        var swipes = 0
        while !target.isHittable && swipes < Self.maxSwipes {
            app.swipeUp(velocity: .slow)
            swipes += 1
        }
    }
}
