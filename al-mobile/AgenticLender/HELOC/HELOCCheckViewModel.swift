import Observation
import os

/// Drives the HELOC check form: which errors show, the bedrooms and term steppers, and Calculate.
///
/// Like the affordability check, an error only shows once the homeowner has left that field or
/// pressed Calculate.
@MainActor
@Observable
final class HELOCCheckViewModel {
    var form = HELOCCheckForm()
    /// The answer to show; the result screen is pushed while this is set.
    var result: HELOCResult?
    /// The check the answer is for, so "Start application" carries exactly what was checked (AL-208).
    private(set) var checkedRequest: HELOCRequest?
    private(set) var isCalculating = false
    private(set) var calculationError: String?
    private var touched: Set<HELOCCheckField> = []

    private let service: HELOCService
    private let logger = Logger(category: "HELOC")

    init(service: HELOCService) {
        self.service = service
    }

    var isComplete: Bool {
        HELOCCheckValidator.errors(for: form).isEmpty
    }

    var canCalculate: Bool { isComplete && !isCalculating }

    /// Why Calculate is disabled: the first problem in screen order, so a grey button always has a reason.
    var calculateHint: String? {
        HELOCCheckField.allCases.lazy.compactMap { HELOCCheckValidator.error(for: $0, in: self.form) }.first
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
        case .county, .propertyType, .berRating, .term: break
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

    /// Checks the form, then asks the endpoint (Figma 07c Calculating, 07d Couldn't calculate).
    /// With errors it shows them all and sends nothing. While one calculation runs, another call
    /// does nothing, so an older answer can't replace a newer one.
    func calculate() async {
        guard !isCalculating else { return }
        touched.formUnion(HELOCCheckField.allCases)
        guard let request = HELOCRequest(form: form) else { return }

        calculationError = nil
        isCalculating = true
        defer { isCalculating = false }
        do {
            let answer = try await service.checkHELOC(request)
            checkedRequest = request
            result = answer
        } catch let error as AffordabilityError {
            fail(with: error.message)
        } catch {
            logger.error("Unexpected HELOC check error: \(error.localizedDescription, privacy: .public)")
            fail(with: AffordabilityError.unavailable.message)
        }
    }

    /// Shows the error and drops the earlier answer, so an old figure doesn't sit next to it.
    private func fail(with message: String) {
        result = nil
        calculationError = message
    }

    /// "Start application": the HELOC form, pre-filled from this check and its answer (Figma 12c).
    /// Nil before an answer, or when there's no equity to borrow against.
    func applicationForm() -> ApplicationForm? {
        guard let result, result.hasEquity, let checkedRequest else { return nil }
        return ApplicationForm(heloc: checkedRequest, result: result)
    }
}
