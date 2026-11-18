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

/// Stands in for Google's own sign-in (AL-320): a token, a cancel (nil) or a failure.
@MainActor
final class FakeGoogleTokenSource: GoogleTokenSource {
    let result: Result<GoogleToken?, Error>
    private(set) var asked = 0

    init(_ result: Result<GoogleToken?, Error>) {
        self.result = result
    }

    func token() async throws -> GoogleToken? {
        asked += 1
        return try result.get()
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

    // MARK: - Google's own sign-in on the hosted build (AL-320)

    func testATokenFromGoogleGoesThroughTheSameSignIn() async {
        let service = FakeGoogleSignInService()
        service.signInResult = .success(.needsProfile(newUser))
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(from: FakeGoogleTokenSource(.success(token)))

        XCTAssertEqual(service.tokens, [token])
        XCTAssertEqual(model.destination, .profile(newUser))
    }

    func testCancellingGooglesSignInStaysOnWelcomeWithNoError() async {
        let service = FakeGoogleSignInService()
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(from: FakeGoogleTokenSource(.success(nil)))

        XCTAssertTrue(service.tokens.isEmpty, "nothing reaches Firebase")
        XCTAssertNil(model.destination)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isWorking)
    }

    func testGoogleFailingShowsTheGoogleMessageAndCanBeTriedAgain() async {
        struct GoogleRefused: Error {}
        let service = FakeGoogleSignInService()
        let model = GoogleSignInViewModel(service: service)

        await model.continueWithGoogle(from: FakeGoogleTokenSource(.failure(GoogleRefused())))

        XCTAssertTrue(service.tokens.isEmpty)
        XCTAssertEqual(model.errorMessage, GoogleSignInViewModel.failureMessage)
        XCTAssertFalse(model.isWorking)

        await model.continueWithGoogle(from: FakeGoogleTokenSource(.success(token)))
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.destination, .home)
    }
}
