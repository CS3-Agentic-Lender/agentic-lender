import Observation
import os

/// Drives the application form: which errors show, the loan warning, the two steppers,
/// and saving the Draft.
///
/// Like the other forms, an error only shows once the borrower has left that field.
@MainActor
@Observable
final class ApplicationViewModel {
    static let savedMessage = "Draft saved. You can review and submit it next."
    /// Changing an existing Draft is the edit-a-draft work (PATCH), so this promises nothing more.
    static let existingDraftMessage = "You already have a draft application, so this one wasn't saved."

    var form: ApplicationForm
    private var touched: Set<ApplicationField> = []
    private(set) var isSaving = false
    private(set) var saveError: String?
    /// What happened to the saved Draft; set once a save succeeds.
    private(set) var saveMessage: String?

    private let service: ApplicationService
    private let logger = Logger(category: "Application")

    init(form: ApplicationForm, service: ApplicationService) {
        self.form = form
        self.service = service
    }

    /// The form has been saved, or matched an existing Draft. Changing a saved Draft is a later step.
    var isSaved: Bool { saveMessage != nil }

    var canSave: Bool { !isSaving && !isSaved }

    /// Checks the form, then saves it as a Draft. With errors it shows them all and sends nothing.
    func save() async {
        guard canSave else { return }
        touched.formUnion(ApplicationField.allCases)
        guard let draft = ApplicationDraft(form: form) else { return }

        saveError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            switch try await service.saveDraft(draft) {
            case .created: saveMessage = Self.savedMessage
            case .existingDraft: saveMessage = Self.existingDraftMessage
            }
        } catch let error as ApplicationSaveError {
            saveError = error.message
        } catch {
            logger.error("Unexpected error saving the application: \(error.localizedDescription, privacy: .public)")
            saveError = ApplicationSaveError.unavailable.message
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
