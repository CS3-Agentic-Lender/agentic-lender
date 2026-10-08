import XCTest
@testable import AgenticLender

/// Records sign-up calls instead of reaching Firebase.
private final class FakeAccountService: AccountService, @unchecked Sendable {
    var result: Result<Void, AccountError> = .success(())
    private(set) var requests: [NewAccount] = []

    func createAccount(_ account: NewAccount) async throws -> String {
        requests.append(account)
        try result.get()
        return "uid-1"
    }
}

@MainActor
final class SignUpViewModelTests: XCTestCase {
    private func fill(_ model: SignUpViewModel) {
        model.form.fullName = "Alice Murphy"
        model.form.email = "alice@test.com"
        model.form.password = TestFixtures.password
        model.form.phone = "087 123 4567"
        model.form.addressLine1 = "12 Oak Park"
        model.form.county = .cork
        model.form.eircode = "a65f4e2"
    }

    func testNoErrorsShowBeforeTheBorrowerTouchesAField() {
        let model = SignUpViewModel(service: FakeAccountService())

        XCTAssertNil(model.visibleError(for: .email))
    }

    func testErrorShowsOnceTheFieldHasBeenLeft() {
        let model = SignUpViewModel(service: FakeAccountService())
        model.form.email = "alice@test"

        model.markTouched(.email)

        XCTAssertEqual(model.visibleError(for: .email), "Enter an email like name@example.com")
    }

    func testErrorClearsAsTheBorrowerFixesIt() {
        let model = SignUpViewModel(service: FakeAccountService())
        model.form.email = "alice@test"
        model.markTouched(.email)

        model.form.email = "alice@test.com"

        XCTAssertNil(model.visibleError(for: .email))
    }

    func testContinueWithErrorsStaysOnTheAccountStepAndShowsThem() {
        let model = SignUpViewModel(service: FakeAccountService())

        model.continueFromAccount()

        XCTAssertEqual(model.step, .account)
        XCTAssertEqual(model.visibleError(for: .fullName), "Enter your full name")
        XCTAssertNil(model.visibleError(for: .phone))
    }

    func testValidAccountStepMovesToDetails() {
        let model = SignUpViewModel(service: FakeAccountService())
        fill(model)

        model.continueFromAccount()

        XCTAssertEqual(model.step, .details)
    }

    func testSubmitWithErrorsDoesNotCallTheService() async {
        let service = FakeAccountService()
        let model = SignUpViewModel(service: service)

        await model.submit()

        XCTAssertTrue(service.requests.isEmpty)
        XCTAssertFalse(model.isAccountCreated)
    }

    func testSubmitCreatesTheAccountWithANormalisedProfile() async throws {
        let service = FakeAccountService()
        let model = SignUpViewModel(service: service)
        fill(model)

        await model.submit()

        let request = try XCTUnwrap(service.requests.first)
        XCTAssertEqual(request.email, "alice@test.com")
        XCTAssertEqual(request.password, TestFixtures.password)
        XCTAssertEqual(request.profile(uid: "uid-1")?.eircode, "A65 F4E2")
        XCTAssertTrue(model.isAccountCreated)
        XCTAssertFalse(model.isSubmitting)
    }

    func testFailedSubmitShowsTheServiceError() async {
        let service = FakeAccountService()
        service.result = .failure(.network)
        let model = SignUpViewModel(service: service)
        fill(model)

        await model.submit()

        XCTAssertEqual(model.submitError, AccountError.network.message)
        XCTAssertFalse(model.isAccountCreated)
        XCTAssertFalse(model.isSubmitting)
    }

    func testEmailAlreadyInUseGoesBackToTheEmailFieldAndShowsTheErrorThere() async {
        let service = FakeAccountService()
        service.result = .failure(.emailAlreadyInUse)
        let model = SignUpViewModel(service: service)
        fill(model)
        model.continueFromAccount()

        await model.submit()

        XCTAssertEqual(model.step, .account)
        XCTAssertEqual(model.visibleError(for: .email), AccountError.emailAlreadyInUse.message)
        XCTAssertNil(model.submitError)
    }

    func testRejectedEmailErrorClearsOnceTheEmailIsChanged() async {
        let service = FakeAccountService()
        service.result = .failure(.invalidEmail)
        let model = SignUpViewModel(service: service)
        fill(model)
        await model.submit()

        model.form.email = "alice.murphy@test.com"

        XCTAssertNil(model.visibleError(for: .email))
    }
}
