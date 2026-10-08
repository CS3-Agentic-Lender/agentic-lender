import FirebaseAuth
import XCTest
@testable import AgenticLender

/// Records sign-in and reset calls instead of reaching Firebase.
final class FakeSignInService: SignInService, @unchecked Sendable {
    var signInResult: Result<Void, SignInError> = .success(())
    var resetResult: Result<Void, SignInError> = .success(())
    private(set) var signIns: [(email: String, password: String)] = []
    private(set) var resets: [String] = []

    func signIn(email: String, password: String) async throws {
        signIns.append((email, password))
        try signInResult.get()
    }

    func sendPasswordReset(to email: String) async throws {
        resets.append(email)
        try resetResult.get()
    }
}

@MainActor
final class SignInViewModelTests: XCTestCase {
    private func filled(_ service: FakeSignInService) -> SignInViewModel {
        let model = SignInViewModel(service: service)
        model.email = " Alice@Test.com "
        model.password = TestFixtures.password
        return model
    }

    func testSignsInWithTheTrimmedLowerCaseEmail() async throws {
        let service = FakeSignInService()
        let model = filled(service)

        await model.signIn()

        let call = try XCTUnwrap(service.signIns.first)
        XCTAssertEqual(call.email, "alice@test.com")
        XCTAssertEqual(call.password, TestFixtures.password)
        XCTAssertTrue(model.isSignedIn)
        XCTAssertFalse(model.isSubmitting)
    }

    func testIncorrectCredentialsShowOneMessageThatDoesNotSayWhichIsWrong() async {
        let service = FakeSignInService()
        service.signInResult = .failure(.incorrectCredentials)
        let model = filled(service)

        await model.signIn()

        XCTAssertEqual(model.signInError, "Email or password is incorrect")
        XCTAssertFalse(model.isSignedIn)
    }

    func testNetworkFailureSaysSo() async {
        let service = FakeSignInService()
        service.signInResult = .failure(.network)
        let model = filled(service)

        await model.signIn()

        XCTAssertEqual(model.signInError, SignInError.network.message)
    }

    func testEmptyFieldsAreCheckedBeforeCallingFirebase() async {
        let service = FakeSignInService()
        let model = SignInViewModel(service: service)

        await model.signIn()

        XCTAssertTrue(service.signIns.isEmpty)
        XCTAssertEqual(model.emailError, "Enter your email")
        XCTAssertEqual(model.passwordError, "Enter your password")
    }

    func testMalformedEmailIsCheckedBeforeCallingFirebase() async {
        let service = FakeSignInService()
        let model = filled(service)
        model.email = "alice@test"

        await model.signIn()

        XCTAssertTrue(service.signIns.isEmpty)
        XCTAssertEqual(model.emailError, "Enter an email like name@example.com")
    }

    func testEditingClearsTheSignInError() async {
        let service = FakeSignInService()
        service.signInResult = .failure(.incorrectCredentials)
        let model = filled(service)
        await model.signIn()

        model.password = TestFixtures.lettersOnlyPassword

        XCTAssertNil(model.signInError)
    }
}

@MainActor
final class ResetPasswordViewModelTests: XCTestCase {
    func testSendsTheResetEmailAndShowsCheckYourEmail() async {
        let service = FakeSignInService()
        let model = ResetPasswordViewModel(service: service, email: " Alice@Test.com ")

        await model.sendLink()

        XCTAssertEqual(service.resets, ["alice@test.com"])
        XCTAssertEqual(model.sentTo, "alice@test.com")
    }

    func testUnknownEmailStillShowsCheckYourEmail() async {
        let service = FakeSignInService()
        service.resetResult = .failure(.incorrectCredentials)
        let model = ResetPasswordViewModel(service: service, email: "nobody@test.com")

        await model.sendLink()

        // Never reveal whether an account exists.
        XCTAssertEqual(model.sentTo, "nobody@test.com")
        XCTAssertNil(model.error)
    }

    func testMalformedEmailIsNotSent() async {
        let service = FakeSignInService()
        let model = ResetPasswordViewModel(service: service, email: "alice")

        await model.sendLink()

        XCTAssertTrue(service.resets.isEmpty)
        XCTAssertEqual(model.error, "Enter an email like name@example.com")
        XCTAssertNil(model.sentTo)
    }

    func testNetworkFailureIsShownAndNothingIsMarkedSent() async {
        let service = FakeSignInService()
        service.resetResult = .failure(.network)
        let model = ResetPasswordViewModel(service: service, email: "alice@test.com")

        await model.sendLink()

        XCTAssertEqual(model.error, SignInError.network.message)
        XCTAssertNil(model.sentTo)
    }
}

final class SignInErrorTests: XCTestCase {
    private func authError(_ code: AuthErrorCode) -> NSError {
        NSError(domain: AuthErrorDomain, code: code.rawValue)
    }

    // A wrong password and an unknown email must look the same to the borrower.
    func testWrongPasswordUnknownUserAndInvalidCredentialAllReadAsIncorrect() {
        for code in [AuthErrorCode.wrongPassword, .userNotFound, .invalidCredential] {
            XCTAssertEqual(SignInError(authError: authError(code)), .incorrectCredentials, "\(code)")
        }
    }

    func testNetworkAndTooManyRequestsAreTheirOwnErrors() {
        XCTAssertEqual(SignInError(authError: authError(.networkError)), .network)
        XCTAssertEqual(SignInError(authError: authError(.tooManyRequests)), .tooManyAttempts)
    }

    func testErrorsFromOtherDomainsAreUnknown() {
        XCTAssertEqual(SignInError(authError: NSError(domain: "Other", code: 17009)), .unknown)
    }
}
