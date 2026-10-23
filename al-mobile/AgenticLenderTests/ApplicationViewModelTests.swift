import XCTest
@testable import AgenticLender

@MainActor
final class ApplicationViewModelTests: XCTestCase {
    private func model(
        form: ApplicationForm,
        service: FakeApplicationService = FakeApplicationService(),
        draftIDs: FakeDraftIDStore = FakeDraftIDStore()
    ) -> ApplicationViewModel {
        ApplicationViewModel(form: form, service: service, draftIDs: draftIDs)
    }

    func testSummarisesTheAffordabilityAnswers() {
        let model = model(form: TestFixtures.applicationForm())

        XCTAssertEqual(model.affordabilitySummary, "Single · €60,000 income · €0 debts · €40,000 deposit")
    }

    func testJointSummaryShowsTheHouseholdIncome() {
        let model = model(
            form: ApplicationForm(affordability: TestFixtures.jointAffordabilityRequest(), maxLoanEur: 270_000, loanType: .mortgage)
        )

        XCTAssertEqual(model.affordabilitySummary, "Joint · €90,000 income · €0 debts · €30,000 deposit")
    }

    func testNoErrorsShowBeforeAFieldIsLeft() {
        let model = model(form: TestFixtures.applicationForm())

        XCTAssertNil(model.visibleError(for: .monthlyTakeHome))
    }

    func testErrorShowsOnceTheFieldIsLeft() {
        let model = model(form: TestFixtures.applicationForm())

        model.markTouched(.monthlyTakeHome)

        XCTAssertEqual(model.visibleError(for: .monthlyTakeHome), "Enter your monthly take-home pay")
    }

    func testTypingRegroupsTheAmount() {
        let model = model(form: TestFixtures.applicationForm())

        model.updateAmount(.loanAmount, to: "260000")

        XCTAssertEqual(model.form.loanAmount, "260,000")
    }

    func testWarningShowsAsSoonAsTheLoanIsAboveTheMaximum() {
        let model = model(form: TestFixtures.applicationForm())

        model.updateAmount(.loanAmount, to: "260000")

        XCTAssertEqual(model.loanWarning, "This is above the €240,000 you could borrow. Your broker may ask you to lower it.")
    }

    func testTermStepsWithinFiveToThirtyFiveYears() {
        var form = TestFixtures.applicationForm()
        form.termYears = 35
        let model = model(form: form)

        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 35)
        XCTAssertFalse(model.canIncreaseTerm)

        model.decreaseTerm()
        XCTAssertEqual(model.form.termYears, 34)
    }

    func testYearsInCurrentJobStaysWithinRange() {
        let model = model(form: TestFixtures.applicationForm())

        model.decreaseYearsInJob()
        XCTAssertEqual(model.form.yearsInCurrentJob, 0)
        XCTAssertFalse(model.canDecreaseYearsInJob)

        model.increaseYearsInJob()
        XCTAssertEqual(model.form.yearsInCurrentJob, 1)
    }

    func testBedroomsStartEmptyAndTheFirstPlusGivesOne() {
        let model = model(form: TestFixtures.applicationForm())
        XCTAssertNil(model.form.property.bedrooms)
        XCTAssertFalse(model.canDecreaseBedrooms)
        XCTAssertTrue(model.canIncreaseBedrooms)

        model.decreaseBedrooms()
        XCTAssertNil(model.form.property.bedrooms)

        model.increaseBedrooms()
        XCTAssertEqual(model.form.property.bedrooms, 1)
    }

    func testBedroomsStepWithinZeroToTwenty() {
        let model = model(form: TestFixtures.applicationForm())
        model.increaseBedrooms()

        for _ in 0..<5 { model.decreaseBedrooms() }
        XCTAssertEqual(model.form.property.bedrooms, 0)
        XCTAssertFalse(model.canDecreaseBedrooms)

        for _ in 0..<25 { model.increaseBedrooms() }
        XCTAssertEqual(model.form.property.bedrooms, 20)
        XCTAssertFalse(model.canIncreaseBedrooms)
    }

    // MARK: - Saving the draft

    func testSavingSendsTheDraftAndSaysItIsSaved() async {
        let service = FakeApplicationService()
        let model = model(form: TestFixtures.filledApplicationForm(), service: service)

        await model.save()

        XCTAssertEqual(service.saved.map(\.loanAmountEur), [210_000])
        XCTAssertEqual(model.saveMessage, ApplicationViewModel.savedMessage)
        XCTAssertNil(model.saveError)
        XCTAssertTrue(model.isSaved)
        XCTAssertFalse(model.isSaving)
    }

    func testAnInvalidFormShowsEveryErrorAndSendsNothing() async {
        let service = FakeApplicationService()
        let model = model(form: TestFixtures.applicationForm(), service: service)

        await model.save()

        XCTAssertTrue(service.saved.isEmpty)
        XCTAssertNotNil(model.visibleError(for: .loanAmount))
        XCTAssertNotNil(model.visibleError(for: .monthlyTakeHome))
        XCTAssertNotNil(model.visibleError(for: .monthlyLivingCosts))
        XCTAssertNotNil(model.visibleError(for: .addressLine1))
        XCTAssertNotNil(model.visibleError(for: .county))
        XCTAssertNotNil(model.visibleError(for: .propertyType))
        XCTAssertNotNil(model.visibleError(for: .bedrooms))
        XCTAssertNotNil(model.visibleError(for: .berRating))
        XCTAssertFalse(model.isSaved)
    }

    func testAnExistingDraftIsUpdatedWithWhatWasTypedAndTheBorrowerIsTold() async {
        let service = FakeApplicationService()
        service.outcome = .success(.existingDraft(id: "app7"))
        let draftIDs = FakeDraftIDStore()
        let model = model(form: TestFixtures.filledApplicationForm(), service: service, draftIDs: draftIDs)

        await model.save()

        XCTAssertEqual(service.edited.map(\.id), ["app7"])
        XCTAssertEqual(service.edited.first?.draft.loanAmountEur, 210_000)
        XCTAssertEqual(draftIDs.storedID, "app7")
        XCTAssertEqual(model.saveMessage, ApplicationViewModel.existingDraftUpdatedMessage)
    }

    func testAFailedSaveSaysWhyAndCanBeTriedAgain() async {
        for failure in [ApplicationSaveError.network, .signedOut, .inProgress, .unavailable] {
            let service = FakeApplicationService()
            service.outcome = .failure(failure)
            let model = model(form: TestFixtures.filledApplicationForm(), service: service)

            await model.save()

            XCTAssertEqual(model.saveError, failure.message, "\(failure)")
            XCTAssertFalse(model.isSaved, "\(failure)")
            XCTAssertTrue(model.canSave, "\(failure)")
        }
    }

    func testTryingAgainClearsTheError() async {
        let service = FakeApplicationService()
        service.outcome = .failure(.network)
        let model = model(form: TestFixtures.filledApplicationForm(), service: service)
        await model.save()

        service.outcome = .success(.created(id: "app42"))
        await model.save()

        XCTAssertNil(model.saveError)
        XCTAssertTrue(model.isSaved)
        XCTAssertEqual(service.saved.count, 2)
    }

    func testASecondSaveChangesTheSameDraft() async {
        let service = FakeApplicationService()
        let model = model(form: TestFixtures.filledApplicationForm(), service: service)
        await model.save()

        model.form.loanAmount = "200,000"
        XCTAssertTrue(model.canSave)
        await model.save()

        XCTAssertEqual(service.saved.count, 1, "only the first save creates a Draft")
        XCTAssertEqual(service.edited.map(\.id), ["app42"])
        XCTAssertEqual(service.edited.first?.draft.loanAmountEur, 200_000)
    }
}

/// Records what it's asked to do and answers with the outcome set for each call.
final class FakeApplicationService: ApplicationService, @unchecked Sendable {
    var outcome: Result<DraftSaveOutcome, ApplicationSaveError> = .success(.created(id: "app42"))
    var editFailure: ApplicationSaveError?
    var loadOutcome: Result<StoredApplication, ApplicationSaveError> = .failure(.draftNotFound)
    private(set) var saved: [ApplicationDraft] = []
    private(set) var edited: [(id: String, draft: ApplicationDraft)] = []
    private(set) var loaded: [String] = []

    func saveDraft(_ draft: ApplicationDraft) async throws -> DraftSaveOutcome {
        saved.append(draft)
        return try outcome.get()
    }

    func editDraft(id: String, _ draft: ApplicationDraft) async throws {
        edited.append((id, draft))
        if let editFailure { throw editFailure }
    }

    func loadApplication(id: String) async throws -> StoredApplication {
        loaded.append(id)
        return try loadOutcome.get()
    }
}

/// Keeps the draft id in memory instead of on the phone.
final class FakeDraftIDStore: DraftIDStore, @unchecked Sendable {
    var storedID: String?

    init(storedID: String? = nil) {
        self.storedID = storedID
    }

    func draftID() -> String? { storedID }
    func remember(_ id: String) { storedID = id }
    func forget() { storedID = nil }
}
