import XCTest
@testable import AgenticLender

/// The Profile screen (AL-312, Figma 19): who is signed in, and the rows it offers.
final class ProfileSummaryTests: XCTestCase {
    private func summary(_ profile: CoreProfile = .aliceWithBob, email: String? = "alice@test.com") -> ProfileSummary {
        ProfileSummary(profile: profile, email: email)
    }

    // MARK: - Initials

    func testInitialsAreTheFirstLettersOfTheFirstTwoNames() {
        XCTAssertEqual(PersonName.initials(of: "Alice Murphy"), "AM")
        XCTAssertEqual(PersonName.initials(of: "aoife de búrca ní bhriain"), "AD")
    }

    func testOneNameGivesOneInitialAndNoNameGivesAQuestionMark() {
        XCTAssertEqual(PersonName.initials(of: "Cher"), "C")
        XCTAssertEqual(PersonName.initials(of: "   "), "?")
        XCTAssertEqual(PersonName.initials(of: nil), "?")
    }

    // MARK: - The header

    func testShowsTheNameEmailAndInitials() {
        let result = summary()

        XCTAssertEqual(result.name, "Alice Byrne")
        XCTAssertEqual(result.email, "alice@test.com")
        XCTAssertEqual(result.initials, "AB")
    }

    // MARK: - Rows

    func testTheRowsAreTheBrokerHelpAndSupportAndRateTheApp() {
        XCTAssertEqual(summary().rows, [.broker(name: "Bob Murphy"), .helpAndSupport, .rateTheApp])
    }

    func testTheBrokerRowStillShowsWithoutAName() {
        XCTAssertEqual(summary(.alice).rows, [.broker(name: nil), .helpAndSupport, .rateTheApp])
    }
}
