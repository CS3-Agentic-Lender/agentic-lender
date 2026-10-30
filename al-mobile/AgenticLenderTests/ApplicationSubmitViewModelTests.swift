import XCTest
@testable import AgenticLender

/// Submitting from "Check your application" (Figma 13 Review, 13a Confirm, 13b Submitted).
@MainActor
final class ApplicationSubmitViewModelTests: XCTestCase {
    private func model(service: FakeApplicationService = FakeApplicationService()) throws -> ApplicationSubmitViewModel {
        let review = try XCTUnwrap(ApplicationReview(form: TestFixtures.filledApplicationForm()))
        return ApplicationSubmitViewModel(review: review, applicationID: "7f3k9qx2abcd", service: service)
    }

    func testSubmitAsksForConfirmationFirstAndSendsNothing() async throws {
        let service = FakeApplicationService()
        let model = try model(service: service)

        model.requestSubmit()

        XCTAssertTrue(model.isConfirming)
        XCTAssertTrue(service.submitted.isEmpty)
    }

    func testCancellingTheConfirmationLeavesTheDraftAlone() async throws {
        let service = FakeApplicationService()
        let model = try model(service: service)
        model.requestSubmit()

        model.cancelSubmit()

        XCTAssertFalse(model.isConfirming)
        XCTAssertTrue(service.submitted.isEmpty)
        XCTAssertNil(model.reference)
    }

    func testConfirmingSubmitsTheSavedDraftAndShowsItsReference() async throws {
        let service = FakeApplicationService()
        let model = try model(service: service)
        model.requestSubmit()

        await model.confirmSubmit()

        XCTAssertEqual(service.submitted, ["7f3k9qx2abcd"])
        XCTAssertEqual(model.reference?.text, "7f3k9qx2")
        XCTAssertFalse(model.isConfirming)
        XCTAssertNil(model.submitError)
    }

    func testAFailedSubmitSaysWhyAndKeepsTheBorrowerOnTheReview() async throws {
        let service = FakeApplicationService()
        service.submitOutcome = .failure(.missingToSubmit("BER rating"))
        let model = try model(service: service)

        await model.confirmSubmit()

        XCTAssertNil(model.reference)
        XCTAssertEqual(model.submitError, "Add the BER rating before you submit.")
    }

    func testNoConnectionSaysToTryAgain() async throws {
        let service = FakeApplicationService()
        service.submitOutcome = .failure(.network)
        let model = try model(service: service)

        await model.confirmSubmit()

        XCTAssertEqual(model.submitError, "We couldn't submit your application. Check your connection and try again.")
    }

    func testBeingSignedOutAsksToSignInToSubmit() async throws {
        let service = FakeApplicationService()
        service.submitOutcome = .failure(.signedOut)
        let model = try model(service: service)

        await model.confirmSubmit()

        XCTAssertEqual(model.submitError, "You've been signed out. Sign in again to submit your application.")
    }

    func testAnApplicationAlreadyPastAppliedSaysItCantBeChanged() async throws {
        let service = FakeApplicationService()
        service.submitOutcome = .failure(.submitted)
        let model = try model(service: service)

        await model.confirmSubmit()

        XCTAssertNil(model.reference)
        XCTAssertEqual(model.submitError, ApplicationSaveError.submitted.message)
    }

    func testATryAgainClearsTheLastError() async throws {
        let service = FakeApplicationService()
        service.submitOutcome = .failure(.network)
        let model = try model(service: service)
        await model.confirmSubmit()
        service.submitOutcome = nil

        await model.confirmSubmit()

        XCTAssertNil(model.submitError)
        XCTAssertNotNil(model.reference)
    }

    func testSubmitIsOffWhileSendingAndOnceSubmitted() async throws {
        let model = try model()
        XCTAssertTrue(model.canSubmit)

        await model.confirmSubmit()

        XCTAssertFalse(model.canSubmit)
    }

    func testASecondSubmitWhileOneIsRunningSendsNothing() async throws {
        let gate = CallGate()
        let service = FakeApplicationService()
        service.gate = gate
        let model = try model(service: service)
        let first = Task { await model.confirmSubmit() }
        await gate.waitForCall()

        model.requestSubmit()
        await model.confirmSubmit()
        gate.open()
        await first.value

        XCTAssertEqual(service.submitted, ["7f3k9qx2abcd"])
        XCTAssertEqual(model.reference?.text, "7f3k9qx2")
    }
}

/// The form's way into the review: only for a saved, unchanged mortgage Draft.
@MainActor
final class ApplicationReviewEntryTests: XCTestCase {
    private func savedModel(_ form: ApplicationForm = TestFixtures.filledApplicationForm()) async -> ApplicationViewModel {
        let model = ApplicationViewModel(form: form, service: FakeApplicationService(), draftIDs: FakeDraftIDStore())
        await model.save()
        return model
    }

    func testASavedDraftCanBeReviewed() async {
        let model = await savedModel()

        XCTAssertEqual(model.reviewTarget?.applicationID, "app42")
        XCTAssertEqual(model.reviewTarget?.review, ApplicationReview(form: TestFixtures.filledApplicationForm()))
    }

    func testAnUnsavedFormCantBeReviewed() {
        let model = ApplicationViewModel(
            form: TestFixtures.filledApplicationForm(),
            service: FakeApplicationService(),
            draftIDs: FakeDraftIDStore()
        )

        XCTAssertNil(model.reviewTarget)
    }

    func testAChangeAfterSavingMustBeSavedBeforeReviewing() async {
        let model = await savedModel()

        model.form.monthlyLivingCosts = "1,500"

        XCTAssertNil(model.reviewTarget)
    }

    func testTheFormIsLockedWhileItSaves() async {
        let gate = CallGate()
        let service = FakeApplicationService()
        service.gate = gate
        let model = ApplicationViewModel(form: TestFixtures.filledApplicationForm(), service: service, draftIDs: FakeDraftIDStore())
        XCTAssertFalse(model.isFormLocked)

        let saving = Task { await model.save() }
        await gate.waitForCall()
        XCTAssertTrue(model.isFormLocked)

        gate.open()
        await saving.value
        XCTAssertFalse(model.isFormLocked)
    }

    func testAChangeMadeDuringASaveMustBeSavedBeforeReviewing() async {
        let gate = CallGate()
        let service = FakeApplicationService()
        service.gate = gate
        let model = ApplicationViewModel(form: TestFixtures.filledApplicationForm(), service: service, draftIDs: FakeDraftIDStore())
        let saving = Task { await model.save() }
        await gate.waitForCall()

        model.form.monthlyLivingCosts = "1,500"
        gate.open()
        await saving.value

        XCTAssertFalse(model.isSaved)
        XCTAssertNil(model.reviewTarget)
    }

    func testAHelocDraftIsSubmittedFromItsOwnFormNotThisOne() async {
        let mortgage = TestFixtures.filledApplicationForm()
        var heloc = ApplicationForm(affordability: mortgage.affordability, maxLoanEur: mortgage.maxLoanEur, loanType: .heloc)
        heloc.loanAmount = mortgage.loanAmount
        heloc.monthlyTakeHome = mortgage.monthlyTakeHome
        heloc.monthlyLivingCosts = mortgage.monthlyLivingCosts
        heloc.property = mortgage.property

        let model = await savedModel(heloc)

        XCTAssertTrue(model.isSaved)
        XCTAssertNil(model.reviewTarget)
    }
}
