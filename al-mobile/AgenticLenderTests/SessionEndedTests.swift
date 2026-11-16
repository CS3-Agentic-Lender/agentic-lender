import FirebaseAuth
import XCTest
@testable import AgenticLender

/// AL-315: a refused token anywhere checks whether the session has ended, and a disabled account
/// signing in fresh is told so, not that a session ended.
@MainActor
final class SessionEndedTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        SessionCheck.tokenRefused = {}
        super.tearDown()
    }

    private func authError(_ code: AuthErrorCode) -> NSError {
        NSError(domain: AuthErrorDomain, code: code.rawValue)
    }

    func testA401FromAnyEndpointChecksWhetherTheSessionHasEnded() async {
        var checks = 0
        SessionCheck.tokenRefused = { checks += 1 }
        StubURLProtocol.response = (401, #"{"error": {"code": "UNAUTHENTICATED"}}"#)
        let gateway = APIGateway(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "token" }, logger: .init(category: "Test"))

        do {
            _ = try await gateway.post("ai/valuation", body: Data("{}".utf8)) { $0 }
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .signedOut)
        }
        XCTAssertEqual(checks, 1)
    }

    func testA401FromAClientOutsideTheGatewayChecksTheSessionToo() async {
        var checks = 0
        SessionCheck.tokenRefused = { checks += 1 }
        StubURLProtocol.response = (401, #"{"error": {"code": "UNAUTHENTICATED"}}"#)
        let client = APISavedCheckClient(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "token" })

        do {
            try await client.delete(id: "check1")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? SavedCheckError, .signedOut)
        }
        XCTAssertEqual(checks, 1)
    }

    func testANetworkFailureDoesntCheckTheSession() async {
        var checks = 0
        SessionCheck.tokenRefused = { checks += 1 }
        StubURLProtocol.failure = URLError(.notConnectedToInternet)
        let gateway = APIGateway(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "token" }, logger: .init(category: "Test"))

        _ = try? await gateway.post("ai/valuation", body: Data("{}".utf8)) { $0 }

        XCTAssertEqual(checks, 0, "the screen keeps its own Retry")
    }

    func testOnlyAnAccountThatIsGoneEndsTheSessionNotTheNetwork() {
        for code in [AuthErrorCode.userNotFound, .userDisabled, .userTokenExpired, .invalidUserToken] {
            XCTAssertTrue(SessionCheck.accountIsGone(authError(code)), "\(code)")
        }
        XCTAssertFalse(SessionCheck.accountIsGone(authError(.networkError)))
        XCTAssertFalse(SessionCheck.accountIsGone(URLError(.timedOut)))
    }

    func testSigningInWithADisabledAccountSaysItsDisabled() {
        XCTAssertEqual(SignInError(authError: authError(.userDisabled)), .accountDisabled)
        XCTAssertEqual(SignInError.accountDisabled.message, "This account has been disabled.")
        XCTAssertEqual(SignInError(authError: authError(.wrongPassword)), .incorrectCredentials)
    }

    func testGoogleSignInWithADisabledAccountSaysItsDisabled() {
        XCTAssertEqual(AccountError(signInError: authError(.userDisabled)), .accountDisabled)
        XCTAssertEqual(AccountError.accountDisabled.message, "This account has been disabled.")
        XCTAssertEqual(AccountError(signInError: authError(.networkError)), .network)
        XCTAssertEqual(AccountError(authError: authError(.userDisabled)), .sessionEnded, "the Home gate still treats it as an ended session")
    }
}
