import XCTest
@testable import AgenticLender

/// Editing a saved Draft: the form reopens with the saved values and saves changes to the same
/// Draft, while a submitted application opens read-only.
@MainActor
final class ApplicationDraftEditingTests: XCTestCase {
    private func model(service: FakeApplicationService, draftIDs: FakeDraftIDStore) -> ApplicationViewModel {
        ApplicationViewModel(form: TestFixtures.applicationForm(), service: service, draftIDs: draftIDs)
    }

    // MARK: - Reopening

    func testReopeningFillsTheFormWithTheSavedDraft() async throws {
        let service = FakeApplicationService()
        service.loadOutcome = .success(try TestFixtures.storedApplication(status: "Draft"))
        let model = model(service: service, draftIDs: FakeDraftIDStore(storedID: "app42"))

        await model.loadSavedDraft()

        XCTAssertEqual(service.loaded, ["app42"])
        XCTAssertEqual(model.form.loanAmount, "210,000")
        XCTAssertEqual(model.form.property.propertyType, .semiDetached)
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.loadError)
    }

    func testWithNoSavedDraftTheFormStartsEmptyWithoutAsking() async {
        let service = FakeApplicationService()
        let model = model(service: service, draftIDs: FakeDraftIDStore())

        await model.loadSavedDraft()

        XCTAssertTrue(service.loaded.isEmpty)
        XCTAssertEqual(model.form.loanAmount, "")
    }

    func testAMissingDraftIsForgottenAndTheFormStartsEmpty() async {
        let service = FakeApplicationService()
        service.loadOutcome = .failure(.draftNotFound)
        let draftIDs = FakeDraftIDStore(storedID: "gone")
        let model = model(service: service, draftIDs: draftIDs)

        await model.loadSavedDraft()

        XCTAssertNil(draftIDs.storedID)
        XCTAssertNil(model.loadError)
        XCTAssertFalse(model.isReadOnly)
    }

    func testAFailedLoadSaysSoAndCanBeTriedAgain() async throws {
        let service = FakeApplicationService()
        service.loadOutcome = .failure(.network)
        let model = model(service: service, draftIDs: FakeDraftIDStore(storedID: "app42"))
        await model.loadSavedDraft()
        XCTAssertEqual(model.loadError, ApplicationViewModel.loadFailedMessage)

        service.loadOutcome = .success(try TestFixtures.storedApplication(status: "Draft"))
        await model.loadSavedDraft()

        XCTAssertNil(model.loadError)
        XCTAssertEqual(model.form.loanAmount, "210,000")
    }

    // MARK: - Editable while Draft, read-only once submitted

    func testADraftCanBeChangedAndSavesToTheSameDraft() async throws {
        let service = FakeApplicationService()
        service.loadOutcome = .success(try TestFixtures.storedApplication(status: "Draft"))
        let model = model(service: service, draftIDs: FakeDraftIDStore(storedID: "app42"))
        await model.loadSavedDraft()

        model.form.monthlyTakeHome = "3,900"
        await model.save()

        XCTAssertFalse(model.isReadOnly)
        XCTAssertTrue(service.saved.isEmpty, "a kept Draft is never created again")
        XCTAssertEqual(service.edited.map(\.id), ["app42"])
        XCTAssertEqual(service.edited.first?.draft.monthlyTakeHomeEur, 3_900)
        XCTAssertEqual(model.saveMessage, ApplicationViewModel.savedMessage)
    }

    func testASubmittedApplicationOpensReadOnlyAndCannotBeSaved() async throws {
        let service = FakeApplicationService()
        service.loadOutcome = .success(try TestFixtures.storedApplication(status: "Applied"))
        let model = model(service: service, draftIDs: FakeDraftIDStore(storedID: "app42"))

        await model.loadSavedDraft()
        await model.save()

        XCTAssertTrue(model.isReadOnly)
        XCTAssertEqual(ApplicationViewModel.readOnlyNote, "Submitted applications can't be changed")
        XCTAssertEqual(model.form.loanAmount, "210,000", "it still shows what was submitted")
        XCTAssertFalse(model.canSave)
        XCTAssertTrue(service.edited.isEmpty)
        XCTAssertTrue(service.saved.isEmpty)
    }

    func testAFinishedApplicationIsForgottenSoANewOneCanStart() async throws {
        for status in ["Declined", "Closed"] {
            let service = FakeApplicationService()
            service.loadOutcome = .success(try TestFixtures.storedApplication(status: status))
            let draftIDs = FakeDraftIDStore(storedID: "app42")
            let model = model(service: service, draftIDs: draftIDs)

            await model.loadSavedDraft()

            XCTAssertNil(draftIDs.storedID, status)
            XCTAssertFalse(model.isReadOnly, status)
            XCTAssertEqual(model.form.loanAmount, "", status)
        }
    }

    func testADraftSubmittedElsewhereTurnsReadOnlyWhenSaved() async {
        let service = FakeApplicationService()
        service.editFailure = .submitted
        let model = model(service: service, draftIDs: FakeDraftIDStore(storedID: "app42"))
        model.form = TestFixtures.filledApplicationForm()

        await model.save()

        XCTAssertTrue(model.isReadOnly)
        XCTAssertFalse(model.canSave)
        XCTAssertNil(model.saveMessage)
    }

    // MARK: - Saving

    func testTheFirstSaveKeepsTheNewDraftsID() async {
        let service = FakeApplicationService()
        let draftIDs = FakeDraftIDStore()
        let model = model(service: service, draftIDs: draftIDs)
        model.form = TestFixtures.filledApplicationForm()

        await model.save()

        XCTAssertEqual(service.saved.count, 1)
        XCTAssertEqual(draftIDs.storedID, "app42")
    }

    func testADraftAlCoreNoLongerHasIsCreatedAgain() async {
        let service = FakeApplicationService()
        service.editFailure = .draftNotFound
        service.outcome = .success(.created(id: "app99"))
        let draftIDs = FakeDraftIDStore(storedID: "gone")
        let model = model(service: service, draftIDs: draftIDs)
        model.form = TestFixtures.filledApplicationForm()

        await model.save()

        XCTAssertEqual(service.edited.map(\.id), ["gone"])
        XCTAssertEqual(service.saved.count, 1)
        XCTAssertEqual(draftIDs.storedID, "app99")
        XCTAssertEqual(model.saveMessage, ApplicationViewModel.savedMessage)
    }
}
