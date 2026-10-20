import Observation
import os

/// Drives the application form: which errors show, the loan warning, the two steppers,
/// reopening the saved Draft, and saving it.
///
/// The first save creates the Draft and keeps its id on the phone; after that, saving changes
/// that Draft. Once submitted, the application opens read-only.
/// Like the other forms, an error only shows once the borrower has left that field.
@MainActor
@Observable
final class ApplicationViewModel {
    static let savedMessage = "Draft saved. You can review and submit it next."
    static let existingDraftUpdatedMessage = "You already had a draft, so it's been updated with these details."
    static let loadFailedMessage = "We couldn't load your saved draft. Check your connection and try again."
    static let readOnlyNote = ApplicationSaveError.submitted.message

    /// Any change clears the saved message, so it never claims unsaved changes are saved.
    var form: ApplicationForm {
        didSet { saveMessage = nil }
    }
    private var touched: Set<ApplicationField> = []
    private(set) var isSaving = false
    private(set) var saveError: String?
    /// What happened to the saved Draft; set once a save succeeds.
    private(set) var saveMessage: String?
    private(set) var isLoading = false
    private(set) var loadError: String?
    /// The application has been submitted: it shows what was sent, and nothing can change.
    private(set) var isReadOnly = false

    private let service: ApplicationService
    private let draftIDs: DraftIDStore
    private let logger = Logger(category: "Application")

    init(form: ApplicationForm, service: ApplicationService, draftIDs: DraftIDStore) {
        self.form = form
        self.service = service
        self.draftIDs = draftIDs
    }

    var isSaved: Bool { saveMessage != nil }

    /// What "Review and submit" opens: the saved Draft, only while the form still matches it
    /// (any change clears `isSaved`). A HELOC is submitted from its own form (AL-208).
    var reviewTarget: (review: ApplicationReview, applicationID: String)? {
        guard isSaved, !isReadOnly, form.loanType == .mortgage,
              let id = draftIDs.draftID(),
              let review = ApplicationReview(form: form)
        else { return nil }
        return (review, id)
    }

    /// Off while the kept Draft failed to load, so the empty form can't be saved over it (Nic on #79).
    var canSave: Bool { !isSaving && !isLoading && loadError == nil && !isReadOnly }

    /// Fills the form from the kept Draft, if there is one. A submitted application opens read-only;
    /// a finished one, or an id al-core no longer has, is forgotten so a new application can start.
    func loadSavedDraft() async {
        guard !isLoading, let id = draftIDs.draftID() else { return }
        loadError = nil
        isLoading = true
        defer { isLoading = false }
        do {
            let stored = try await service.loadApplication(id: id)
            guard !stored.isFinished else { return draftIDs.forget() }
            form = stored.filling(form)
            isReadOnly = !stored.isDraft
        } catch ApplicationSaveError.draftNotFound {
            draftIDs.forget()
        } catch {
            logger.error("Couldn't load the saved draft: \(error.localizedDescription, privacy: .public)")
            loadError = Self.loadFailedMessage
        }
    }

    /// Checks the form, then saves it. With errors it shows them all and sends nothing.
    func save() async {
        guard canSave else { return }
        touched.formUnion(ApplicationField.allCases)
        guard let draft = ApplicationDraft(form: form) else { return }

        saveError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            saveMessage = try await store(draft)
        } catch ApplicationSaveError.submitted {
            isReadOnly = true
        } catch let error as ApplicationSaveError {
            saveError = error.message
        } catch {
            logger.error("Unexpected error saving the application: \(error.localizedDescription, privacy: .public)")
            saveError = ApplicationSaveError.unavailable.message
        }
    }

    /// Changes the kept Draft, or creates one and keeps its id. If the borrower already had a Draft
    /// (another phone, say), that one is kept and changed to match the form.
    private func store(_ draft: ApplicationDraft) async throws -> String {
        if let id = draftIDs.draftID() {
            do {
                try await service.editDraft(id: id, draft)
                return Self.savedMessage
            } catch ApplicationSaveError.draftNotFound {
                draftIDs.forget()
            }
        }
        switch try await service.saveDraft(draft) {
        case .created(let id):
            draftIDs.remember(id)
            return Self.savedMessage
        case .existingDraft(let id):
            draftIDs.remember(id)
            try await service.editDraft(id: id, draft)
            return Self.existingDraftUpdatedMessage
        }
    }

    /// "Single · €60,000 income · €250 debts · €30,000 deposit" (Figma 12, "From your affordability check").
    var affordabilitySummary: String {
        let answers = form.affordability
        return [
            answers.isJoint ? "Joint" : "Single",
            "€\(EuroAmount.format(answers.householdGrossIncome)) income",
            "€\(EuroAmount.format(answers.monthlyDebts)) debts",
            "€\(EuroAmount.format(answers.deposit)) deposit",
        ].joined(separator: " · ")
    }

    var loanWarning: String? { ApplicationValidator.loanWarning(for: form) }

    var canIncreaseTerm: Bool { form.termYears < AffordabilityValidator.termRange.upperBound }
    var canDecreaseTerm: Bool { form.termYears > AffordabilityValidator.termRange.lowerBound }
    var canIncreaseYearsInJob: Bool { form.yearsInCurrentJob < ApplicationForm.yearsInJobRange.upperBound }
    var canDecreaseYearsInJob: Bool { form.yearsInCurrentJob > ApplicationForm.yearsInJobRange.lowerBound }
    var canIncreaseBedrooms: Bool {
        form.property.bedrooms.map { $0 < ApplicationProperty.bedroomsRange.upperBound } ?? true
    }
    var canDecreaseBedrooms: Bool {
        form.property.bedrooms.map { $0 > ApplicationProperty.bedroomsRange.lowerBound } ?? false
    }

    func visibleError(for field: ApplicationField) -> String? {
        guard touched.contains(field) else { return nil }
        return ApplicationValidator.error(for: field, in: form)
    }

    func markTouched(_ field: ApplicationField) {
        touched.insert(field)
    }

    /// Stores what was typed into an amount field, regrouping its thousands separators.
    func updateAmount(_ field: ApplicationField, to text: String) {
        let regrouped = EuroAmount.regroup(text)
        switch field {
        case .monthlyTakeHome: form.monthlyTakeHome = regrouped
        case .monthlyLivingCosts: form.monthlyLivingCosts = regrouped
        case .loanAmount: form.loanAmount = regrouped
        case .askingPrice: form.property.askingPrice = regrouped
        case .floorArea: form.property.floorArea = regrouped
        case .addressLine1, .eircode, .county, .propertyType, .bedrooms, .berRating: break
        }
    }

    func increaseTerm() {
        guard canIncreaseTerm else { return }
        form.termYears += 1
    }

    func decreaseTerm() {
        guard canDecreaseTerm else { return }
        form.termYears -= 1
    }

    func increaseYearsInJob() {
        guard canIncreaseYearsInJob else { return }
        form.yearsInCurrentJob += 1
    }

    func decreaseYearsInJob() {
        guard canDecreaseYearsInJob else { return }
        form.yearsInCurrentJob -= 1
    }

    /// The first + on an empty count gives one bedroom.
    func increaseBedrooms() {
        guard canIncreaseBedrooms else { return }
        form.property.bedrooms = form.property.bedrooms.map { $0 + 1 } ?? 1
        markTouched(.bedrooms)
    }

    func decreaseBedrooms() {
        guard canDecreaseBedrooms, let bedrooms = form.property.bedrooms else { return }
        form.property.bedrooms = bedrooms - 1
        markTouched(.bedrooms)
    }
}
