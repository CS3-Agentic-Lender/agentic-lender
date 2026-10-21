import XCTest
@testable import AgenticLender

/// Records Google sign-ins and profile saves instead of reaching Firebase and al-core.
final class FakeGoogleSignInService: GoogleSignInService, @unchecked Sendable {
    var signInResult: Result<GoogleSignInOutcome, AccountError> = .success(.signedIn)
    var completeResult: Result<Void, AccountError> = .success(())
    private(set) var tokens: [GoogleToken] = []
    private(set) var savedProfiles: [BorrowerProfile] = []

    func signIn(with token: GoogleToken) async throws -> GoogleSignInOutcome {
        tokens.append(token)
        return try signInResult.get()
    }

    func completeProfile(_ profile: BorrowerProfile) async throws {
        savedProfiles.append(profile)
        try completeResult.get()
    }
}

@MainActor
final class GoogleSignInViewModelTests: XCTestCase {
    private let token = GoogleToken(idToken: "id-token", accessToken: "")
    private let newUser = GoogleUser(email: "aoife@gmail.com", name: "Aoife Byrne")

    func testReturningGoogleUserGoesStraightToHome() async throws {
        let service = FakeGoogleSignInService()
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(token)

        XCTAssertEqual(service.tokens, [token])
        XCTAssertEqual(model.destination, .home)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isWorking)
    }

    func testFirstTimeGoogleUserGoesToTheProfileScreen() async {
        let service = FakeGoogleSignInService()
        service.signInResult = .success(.needsProfile(newUser))
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(token)

        XCTAssertEqual(model.destination, .profile(newUser))
    }

    func testNoConnectionSaysSoAndStaysPut() async {
        let service = FakeGoogleSignInService()
        service.signInResult = .failure(.network)
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(token)

        XCTAssertNil(model.destination)
        XCTAssertEqual(model.errorMessage, CommonMessage.cantReachServer)
    }

    func testAnyOtherFailureShowsAGoogleMessage() async {
        let service = FakeGoogleSignInService()
        service.signInResult = .failure(.unknown)
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(token)

        XCTAssertNil(model.destination)
        XCTAssertEqual(model.errorMessage, "Something went wrong signing in with Google. Try again.")
    }

    func testComingBackFromTheProfileScreenLetsTheBorrowerStartAgain() async {
        let service = FakeGoogleSignInService()
        service.signInResult = .success(.needsProfile(newUser))
        let model = GoogleSignInViewModel(service: service)
        await model.continueWithGoogle(token)

        model.leaveDestination()

        XCTAssertNil(model.destination)
    }

    func testTryingAgainClearsTheOldError() async {
        let service = FakeGoogleSignInService()
        service.signInResult = .failure(.network)
        let model = GoogleSignInViewModel(service: service)
        await model.continueWithGoogle(token)

        service.signInResult = .success(.signedIn)
        await model.continueWithGoogle(token)

        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.destination, .home)
    }
}
