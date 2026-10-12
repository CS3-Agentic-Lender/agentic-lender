import Observation
import os

/// Drives the affordability form: which errors show, the term stepper, when Calculate is allowed,
/// and the calculation itself.
///
/// Like sign-up, an error only shows once the borrower has left that field or pressed Calculate.
@MainActor
@Observable
final class AffordabilityViewModel {
    var form = AffordabilityForm()
    /// The latest result from the affordability endpoint.
    private(set) var result: AffordabilityResult?
    private(set) var isCalculating = false
    private(set) var calculationError: String?
    private var touched: Set<AffordabilityField> = []

    private let service: AffordabilityService
    private let logger = Logger(category: "Affordability")

    init(service: AffordabilityService) {
        self.service = service
    }

    var canCalculate: Bool {
        AffordabilityValidator.errors(for: form).isEmpty
    }

    /// Why Calculate is disabled: the first problem in screen order, even for a field not yet left,
    /// so a grey button always comes with a reason. Nil once the form is valid.
    var calculateHint: String? {
        AffordabilityField.allCases.lazy.compactMap { AffordabilityValidator.error(for: $0, in: self.form) }.first
    }

    var canIncreaseTerm: Bool { form.termYears < AffordabilityValidator.termRange.upperBound }
    var canDecreaseTerm: Bool { form.termYears > AffordabilityValidator.termRange.lowerBound }

    func visibleError(for field: AffordabilityField) -> String? {
        guard touched.contains(field) else { return nil }
        return AffordabilityValidator.error(for: field, in: form)
    }

    func markTouched(_ field: AffordabilityField) {
        touched.insert(field)
    }

    /// Stores what was typed into an amount field, regrouping its thousands separators.
    func updateAmount(_ field: AffordabilityField, to text: String) {
        let regrouped = EuroAmount.regroup(text)
        switch field {
        case .income: form.income = regrouped
        case .secondIncome: form.secondIncome = regrouped
        case .monthlyDebts: form.monthlyDebts = regrouped
        case .deposit: form.deposit = regrouped
        case .term: break
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

    /// Checks the form, then asks the endpoint for the result (Figma 07c Calculating, 07d Couldn't calculate).
    /// With errors in the form it shows them all and sends nothing.
    func calculate() async {
        touched.formUnion(AffordabilityField.allCases)
        guard let request = AffordabilityRequest(form: form) else { return }

        calculationError = nil
        isCalculating = true
        defer { isCalculating = false }
        do {
            result = try await service.calculate(request)
        } catch let error as AffordabilityError {
            calculationError = error.message
        } catch {
            logger.error("Unexpected affordability error: \(error.localizedDescription, privacy: .public)")
            calculationError = AffordabilityError.unavailable.message
        }
    }
}
