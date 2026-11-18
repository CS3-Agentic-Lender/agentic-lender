import XCTest
@testable import AgenticLender

/// The tab bar (AL-313): Home, Property, Messages and Profile once the borrower has a broker,
/// the Messages badge, and returning home after an application is submitted.
@MainActor
final class MainTabsTests: XCTestCase {
    // MARK: - Criterion 1: the tabs open once the gate has a borrower with a broker

    func testTheGateOpensTheTabsWithTheBorrowersProfile() {
        let session = AppSession(state: FakeSignedInState(hasSignedInUser: true))
        let stackBefore = session.stackID

        session.showMain(.aliceWithBob)

        XCTAssertEqual(session.start, .main(.aliceWithBob))
        XCTAssertNotEqual(session.stackID, stackBefore, "the tabs replace the gate's stack instead of being pushed on it")
    }

    func testTheTabsOpenOnHome() {
        XCTAssertEqual(MainTabs().selected, .home)
        XCTAssertEqual(MainTabs.Tab.allCases, [.home, .property, .messages, .profile])
    }

    // MARK: - Criterion 4: the Messages badge

    func testTheBadgeShowsUnreadRepliesAndIsHiddenAtZero() {
        XCTAssertEqual(MainTabs.messagesBadge(unread: 3), 3)
        XCTAssertEqual(MainTabs.messagesBadge(unread: 0), 0, "SwiftUI hides a badge of 0")
    }

    // MARK: - Criterion 5: "Check a property" opens the Property tab

    func testCheckAPropertySwitchesToThePropertyTab() {
        var tabs = MainTabs()

        tabs.checkProperty()

        XCTAssertEqual(tabs.selected, .property)
    }

    // MARK: - Criterion 6: sign out, and back to Home after submitting

    func testReturningHomeFromTheTabsSelectsHomeAndResetsOnlyItsStack() {
        let session = AppSession(state: FakeSignedInState(hasSignedInUser: true))
        session.showMain(.aliceWithBob)
        let stackBefore = session.stackID
        let homeBefore = session.homeResetCount

        session.returnHome()

        XCTAssertEqual(session.start, .main(.aliceWithBob), "the tabs stay, so the other tabs keep their place")
        XCTAssertEqual(session.stackID, stackBefore)
        XCTAssertEqual(session.homeResetCount, homeBefore + 1)

        var tabs = MainTabs(selected: .property)
        tabs.returnedHome()
        XCTAssertEqual(tabs.selected, .home)
    }

    func testSigningOutFromTheTabsGoesBackToWelcome() {
        let session = AppSession(state: FakeSignedInState(hasSignedInUser: true))
        session.showMain(.aliceWithBob)

        session.signOut()

        XCTAssertEqual(session.start, .welcome)
    }
}
