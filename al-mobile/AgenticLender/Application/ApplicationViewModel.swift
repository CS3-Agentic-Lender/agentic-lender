import Observation

/// Drives the application form: which errors show, the loan warning, and the two steppers.
///
/// Like the other forms, an error only shows once the borrower has left that field.
@MainActor
@Observable
final class ApplicationViewModel {
    var form: ApplicationForm
    private var touched: Set<ApplicationField> = []

    init(form: ApplicationForm) {
        self.form = form
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
}
