import Observation

/// Drives the HELOC check form: which errors show and the bedrooms and term steppers.
///
/// Like the affordability check, an error only shows once the homeowner has left that field.
/// Calculate joins once the HELOC request shape is agreed (AL-198).
@MainActor
@Observable
final class HELOCCheckViewModel {
    var form = HELOCCheckForm()
    private var touched: Set<HELOCCheckField> = []

    var isComplete: Bool {
        HELOCCheckValidator.errors(for: form).isEmpty
    }

    var canDecreaseBedrooms: Bool { form.bedrooms > 0 }
    var canIncreaseTerm: Bool { form.termYears < AffordabilityValidator.termRange.upperBound }
    var canDecreaseTerm: Bool { form.termYears > AffordabilityValidator.termRange.lowerBound }

    func visibleError(for field: HELOCCheckField) -> String? {
        guard touched.contains(field) else { return nil }
        return HELOCCheckValidator.error(for: field, in: form)
    }

    func markTouched(_ field: HELOCCheckField) {
        touched.insert(field)
    }

    /// Stores what was typed into a number field, regrouping its thousands separators.
    func updateText(_ field: HELOCCheckField, to text: String) {
        let regrouped = EuroAmount.regroup(text)
        switch field {
        case .floorArea: form.floorArea = regrouped
        case .mortgageBalance: form.mortgageBalance = regrouped
        case .income: form.income = regrouped
        case .monthlyDebts: form.monthlyDebts = regrouped
        case .county, .berRating, .term: break
        }
    }

    func increaseBedrooms() {
        form.bedrooms += 1
    }

    func decreaseBedrooms() {
        guard canDecreaseBedrooms else { return }
        form.bedrooms -= 1
    }

    func increaseTerm() {
        guard canIncreaseTerm else { return }
        form.termYears += 1
    }

    func decreaseTerm() {
        guard canDecreaseTerm else { return }
        form.termYears -= 1
    }
}
