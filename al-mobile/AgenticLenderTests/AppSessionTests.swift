import XCTest
@testable import AgenticLender

/// Stands in for Firebase Auth's saved login.
final class FakeSignedInState: SignedInState, @unchecked Sendable {
    var hasSignedInUser: Bool
    var signOutFailure: Error?
    private(set) var signOutCount = 0

    init(hasSignedInUser: Bool) {
        self.hasSignedInUser = hasSignedInUser
    }

    func signOut() throws {
        signOutCount += 1
        if let signOutFailure { throw signOutFailure }
        hasSignedInUser = false
    }
}

@MainActor
final class AppSessionTests: XCTestCase {
    private struct KeychainTrouble: Error {}

    func testOpensOnHomeWhenALoginIsSaved() {
        let session = AppSession(state: FakeSignedInState(hasSignedInUser: true))

        XCTAssertEqual(session.start, .home)
    }

    func testOpensOnWelcomeWhenNobodyIsSignedIn() {
        let session = AppSession(state: FakeSignedInState(hasSignedInUser: false))

        XCTAssertEqual(session.start, .welcome)
    }

    func testSignOutGoesBackToWelcomeAndStartsTheScreensAfresh() {
        let state = FakeSignedInState(hasSignedInUser: true)
        let session = AppSession(state: state)
        let stackBefore = session.stackID

        session.signOut()

        XCTAssertEqual(state.signOutCount, 1)
        XCTAssertEqual(session.start, .welcome)
        XCTAssertNotEqual(session.stackID, stackBefore)
        XCTAssertNil(session.signOutError)
    }

    func testReturningHomeAfterSubmittingStartsTheScreensAfreshOnHome() {
        // Signing in from Welcome leaves start at .welcome, with home pushed on top.
        let state = FakeSignedInState(hasSignedInUser: false)
        let session = AppSession(state: state)
        state.hasSignedInUser = true
        let stackBefore = session.stackID

        session.returnHome()

        XCTAssertEqual(session.start, .home)
        XCTAssertNotEqual(session.stackID, stackBefore)
        XCTAssertEqual(state.signOutCount, 0)
    }

    func testAfterSigningOutTheNextLaunchOpensOnWelcome() {
        let state = FakeSignedInState(hasSignedInUser: true)
        AppSession(state: state).signOut()

        let nextLaunch = AppSession(state: state)

        XCTAssertEqual(nextLaunch.start, .welcome)
    }

    func testSigningOutAfterSigningInFromWelcomeAlsoStartsAfresh() {
        // Signing in from Welcome pushes home onto the Welcome stack, so start is still .welcome.
        let state = FakeSignedInState(hasSignedInUser: false)
        let session = AppSession(state: state)
        state.hasSignedInUser = true
        let stackBefore = session.stackID

        session.signOut()

        XCTAssertEqual(session.start, .welcome)
        XCTAssertNotEqual(session.stackID, stackBefore)
    }

    func testAFailedSignOutStaysPutAndSaysSo() {
        let state = FakeSignedInState(hasSignedInUser: true)
        state.signOutFailure = KeychainTrouble()
        let session = AppSession(state: state)
        let stackBefore = session.stackID

        session.signOut()

        XCTAssertEqual(session.start, .home)
        XCTAssertEqual(session.stackID, stackBefore)
        XCTAssertEqual(session.signOutError, AppSession.signOutFailedMessage)
    }

    func testTryingAgainAfterAFailedSignOutClearsTheMessage() {
        let state = FakeSignedInState(hasSignedInUser: true)
        state.signOutFailure = KeychainTrouble()
        let session = AppSession(state: state)
        session.signOut()

        state.signOutFailure = nil
        session.signOut()

        XCTAssertNil(session.signOutError)
        XCTAssertEqual(session.start, .welcome)
    }
}
