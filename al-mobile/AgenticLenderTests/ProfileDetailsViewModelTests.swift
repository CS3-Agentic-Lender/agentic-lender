import XCTest
@testable import AgenticLender

/// Holds the profile save open until the test releases it, to look at the screen mid-save.
private final class SlowGoogleSignInService: GoogleSignInService, @unchecked Sendable {
    private(set) var saves = 0
    let gate: CallGate

    init(gate: CallGate) {
        self.gate = gate
    }

    func signIn(with token: GoogleToken) async throws -> GoogleSignInOutcome { .signedIn }

    func completeProfile(_ profile: BorrowerProfile) async throws {
        saves += 1
        await gate.pass()
    }
}

/// The profile screen a first-time Google user fills in before reaching home (AL-94 AC2).
@MainActor
final class ProfileDetailsViewModelTests: XCTestCase {
    private let user = GoogleUser(email: "aoife@gmail.com", name: "Aoife Byrne")

    private func filled(_ service: GoogleSignInService) -> ProfileDetailsViewModel {
        let model = ProfileDetailsViewModel(user: user, service: service)
        model.form.phone = "087 123 4567"
        model.form.addressLine1 = "12 Lough Road"
        model.form.county = .cork
        model.form.eircode = "t12 x5r2"
        return model
    }

    func testStartsWithTheGoogleNameAndEmail() {
        let model = ProfileDetailsViewModel(user: user, service: FakeGoogleSignInService())

        XCTAssertEqual(model.form.fullName, "Aoife Byrne")
        XCTAssertEqual(model.email, "aoife@gmail.com")
    }

    func testSavesTheProfileWithTheGoogleEmailAndNoPassword() async throws {
        let service = FakeGoogleSignInService()
        let model = filled(service)

        await model.submit()

        let saved = try XCTUnwrap(service.savedProfiles.first)
        XCTAssertEqual(saved.email, "aoife@gmail.com")
        XCTAssertEqual(saved.fullName, "Aoife Byrne")
        XCTAssertEqual(saved.phone, "+353871234567")
        XCTAssertEqual(saved.eircode, "T12 X5R2")
        XCTAssertTrue(model.isProfileSaved)
    }

    /// AL-240: Your details has sign-up's length limits on the name and both address lines.
    func testANameOrAddressOverTheLimitShowsUnderItsFieldAndSavesNothing() async throws {
        let service = FakeGoogleSignInService()
        let model = filled(service)
        model.form.fullName = String(repeating: "a", count: 101)
        model.form.addressLine2 = String(repeating: "b", count: 201)

        await model.submit()

        XCTAssertEqual(model.visibleError(for: .fullName), "Use 100 characters or fewer")
        XCTAssertEqual(model.visibleError(for: .addressLine2), "Use 200 characters or fewer")
        XCTAssertTrue(service.savedProfiles.isEmpty)
    }

    func testTheEmailCannotBeChangedFromTheGoogleOne() async throws {
        let service = FakeGoogleSignInService()
        let model = filled(service)
        model.form.email = "someone.else@example.com"

        await model.submit()

        XCTAssertEqual(try XCTUnwrap(service.savedProfiles.first).email, "aoife@gmail.com")
    }

    func testCannotFinishUntilEveryProfileFieldIsFilledIn() async {
        let service = FakeGoogleSignInService()
        let model = ProfileDetailsViewModel(user: user, service: service)

        await model.submit()

        XCTAssertTrue(service.savedProfiles.isEmpty)
        XCTAssertFalse(model.isProfileSaved)
        XCTAssertEqual(model.visibleError(for: .phone), "Enter your phone number")
        XCTAssertEqual(model.visibleError(for: .county), "Choose your county")
        XCTAssertNil(model.visibleError(for: .password), "a Google user has no password")
    }

    func testErrorsOnlyShowOnceAFieldIsLeft() {
        let model = ProfileDetailsViewModel(user: user, service: FakeGoogleSignInService())

        XCTAssertNil(model.visibleError(for: .eircode))
        model.markTouched(.eircode)
        XCTAssertEqual(model.visibleError(for: .eircode), "Enter your Eircode")
    }

    func testASaveThatFailsShowsWhyAndStaysOnTheScreen() async {
        let service = FakeGoogleSignInService()
        service.completeResult = .failure(.profileNotSaved)
        let model = filled(service)

        await model.submit()

        XCTAssertFalse(model.isProfileSaved)
        XCTAssertEqual(model.submitError, AccountError.profileNotSaved.message)
        XCTAssertFalse(model.isSubmitting)
    }

    // MARK: Sign out (AL-256)

    func testSignOutIsOfferedBeforeAnythingIsSaved() {
        let model = ProfileDetailsViewModel(user: user, service: FakeGoogleSignInService())

        XCTAssertTrue(model.canSignOut)
    }

    func testSignOutIsOffWhileContinueIsSavingTheProfile() async {
        let gate = CallGate()
        let service = SlowGoogleSignInService(gate: gate)
        let model = filled(service)

        let saving = Task { await model.submit() }
        await gate.waitForCall()
        XCTAssertFalse(model.canSignOut)

        gate.open()
        await saving.value
        XCTAssertFalse(model.isSubmitting)
    }

    func testSignOutComesBackAfterASaveFails() async {
        let service = FakeGoogleSignInService()
        service.completeResult = .failure(.profileNotSaved)
        let model = filled(service)

        await model.submit()

        XCTAssertTrue(model.canSignOut)
    }
}
