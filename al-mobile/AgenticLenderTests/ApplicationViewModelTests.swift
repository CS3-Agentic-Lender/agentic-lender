import XCTest
@testable import AgenticLender

@MainActor
final class ApplicationViewModelTests: XCTestCase {
    private func model(form: ApplicationForm, service: FakeApplicationService = FakeApplicationService()) -> ApplicationViewModel {
        ApplicationViewModel(form: form, service: service)
    }

    func testSummarisesTheAffordabilityAnswers() {
        let model = model(form: TestFixtures.applicationForm())

        XCTAssertEqual(model.affordabilitySummary, "Single · €60,000 income · €0 debts · €40,000 deposit")
    }

    func testJointSummaryShowsTheHouseholdIncome() {
        let model = model(
            form: ApplicationForm(affordability: TestFixtures.jointAffordabilityRequest(), maxLoanEur: 270_000)
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
        XCTAssertFalse(model.isSaved)
    }

    func testAnExistingDraftIsKeptAndTheBorrowerIsTold() async {
        let service = FakeApplicationService()
        service.outcome = .success(.existingDraft(id: "app7"))
        let model = model(form: TestFixtures.filledApplicationForm(), service: service)

        await model.save()

        XCTAssertEqual(model.saveMessage, ApplicationViewModel.existingDraftMessage)
        XCTAssertTrue(model.isSaved)
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

    func testASavedDraftCannotBeSavedAgainFromThisForm() async {
        let service = FakeApplicationService()
        let model = model(form: TestFixtures.filledApplicationForm(), service: service)
        await model.save()

        XCTAssertFalse(model.canSave)
        await model.save()

        XCTAssertEqual(service.saved.count, 1)
    }
}

/// Records the drafts it's given and answers with `outcome`.
final class FakeApplicationService: ApplicationService, @unchecked Sendable {
    var outcome: Result<DraftSaveOutcome, ApplicationSaveError> = .success(.created(id: "app42"))
    private(set) var saved: [ApplicationDraft] = []

    func saveDraft(_ draft: ApplicationDraft) async throws -> DraftSaveOutcome {
        saved.append(draft)
        return try outcome.get()
    }
}
