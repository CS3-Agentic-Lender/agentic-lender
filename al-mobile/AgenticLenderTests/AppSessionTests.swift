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

    private var signedOutHandler: (@MainActor () -> Void)?

    func onSignedOut(_ handler: @escaping @MainActor () -> Void) {
        signedOutHandler = handler
    }

    /// Firebase signing the user out by itself, as when a token refresh finds the account gone (AL-315).
    @MainActor
    func firebaseSignedOut() {
        hasSignedInUser = false
        signedOutHandler?()
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

    // MARK: - Signing out with a message for Welcome (AL-258)

    func testSigningOutWithAMessageShowsItOnWelcome() {
        let state = FakeSignedInState(hasSignedInUser: true)
        let session = AppSession(state: state)

        session.signOut(notice: HomeGateViewModel.noEmailMessage)

        XCTAssertEqual(state.signOutCount, 1)
        XCTAssertEqual(session.start, .welcome)
        XCTAssertEqual(session.welcomeNotice, HomeGateViewModel.noEmailMessage)
    }

    func testAnOrdinarySignOutLeavesNoMessageOnWelcome() {
        let state = FakeSignedInState(hasSignedInUser: true)
        let session = AppSession(state: state)
        session.signOut(notice: HomeGateViewModel.noEmailMessage)
        state.hasSignedInUser = true

        session.signOut()

        XCTAssertNil(session.welcomeNotice)
    }

    func testAFailedSignOutWithAMessageShowsTheUsualSignOutError() {
        let state = FakeSignedInState(hasSignedInUser: true)
        state.signOutFailure = KeychainTrouble()
        let session = AppSession(state: state)

        session.signOut(notice: HomeGateViewModel.noEmailMessage)

        XCTAssertEqual(session.start, .home)
        XCTAssertEqual(session.signOutError, AppSession.signOutFailedMessage)
        XCTAssertNil(session.welcomeNotice)
    }

    // MARK: - AL-315: the session ends on any screen

    func testWhenFirebaseSignsTheUserOutTheAppShowsWelcomeWithTheMessage() {
        let state = FakeSignedInState(hasSignedInUser: true)
        let session = AppSession(state: state)
        let stackBefore = session.stackID

        state.firebaseSignedOut()

        XCTAssertEqual(session.start, .welcome)
        XCTAssertEqual(session.welcomeNotice, "Your session has ended. Please sign in again.")
        XCTAssertNotEqual(session.stackID, stackBefore)
    }

    func testTheAppsOwnSignOutShowsNoSessionEndedMessage() {
        let state = FakeSignedInState(hasSignedInUser: true)
        let session = AppSession(state: state)

        session.signOut()
        state.firebaseSignedOut() // Firebase reports the sign-out the app asked for

        XCTAssertEqual(session.start, .welcome)
        XCTAssertNil(session.welcomeNotice)
    }

    func testASignOutWithItsOwnMessageKeepsThatMessage() {
        let state = FakeSignedInState(hasSignedInUser: true)
        let session = AppSession(state: state)

        session.signOut(notice: HomeGateViewModel.noEmailMessage)
        state.firebaseSignedOut()

        XCTAssertEqual(session.welcomeNotice, HomeGateViewModel.noEmailMessage)
    }
}
