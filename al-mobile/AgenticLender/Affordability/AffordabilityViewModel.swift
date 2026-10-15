import Observation

/// Drives the affordability form: which errors show, the term stepper, and when Calculate is allowed.
///
/// Like sign-up, an error only shows once the borrower has left that field or pressed Calculate.
@MainActor
@Observable
final class AffordabilityViewModel {
    var form = AffordabilityForm()
    private var touched: Set<AffordabilityField> = []

    var canCalculate: Bool {
        AffordabilityValidator.errors(for: form).isEmpty
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

    /// The checked request, or nil after showing every error.
    func calculate() -> AffordabilityRequest? {
        touched.formUnion(AffordabilityField.allCases)
        return AffordabilityRequest(form: form)
    }
}
