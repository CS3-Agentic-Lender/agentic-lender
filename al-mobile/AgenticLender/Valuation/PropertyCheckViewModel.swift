import Observation
import os

/// Drives the property check form: which errors show, the bedrooms stepper, and Check value.
///
/// Like the other checks, an error only shows once the borrower has left that field or pressed
/// Check value.
@MainActor
@Observable
final class PropertyCheckViewModel {
    var form = PropertyCheckForm()
    /// The estimate from the last check.
    private(set) var result: ValuationResult?
    /// The result screen's text; the screen is pushed while this is set. Closing it clears both.
    var summary: ValuationSummary? {
        didSet { if summary == nil { result = nil } }
    }
    private(set) var isValuing = false
    private(set) var checkError: String?
    private var touched: Set<PropertyCheckField> = []

    private let service: ValuationService
    private let logger = Logger(category: "Valuation")

    init(service: ValuationService) {
        self.service = service
    }

    var canCheck: Bool { checkHint == nil && !isValuing }

    /// Why Check value is disabled: the first problem in screen order, so a grey button always has a reason.
    var checkHint: String? {
        PropertyCheckField.allCases.lazy.compactMap { PropertyCheckValidator.error(for: $0, in: self.form) }.first
    }

    var canDecreaseBedrooms: Bool { form.bedrooms > PropertyCheckValidator.bedroomsRange.lowerBound }
    var canIncreaseBedrooms: Bool { form.bedrooms < PropertyCheckValidator.bedroomsRange.upperBound }

    func visibleError(for field: PropertyCheckField) -> String? {
        guard touched.contains(field) else { return nil }
        return PropertyCheckValidator.error(for: field, in: form)
    }

    func markTouched(_ field: PropertyCheckField) {
        touched.insert(field)
    }

    /// Stores what was typed into a number field, regrouping its thousands separators.
    func updateText(_ field: PropertyCheckField, to text: String) {
        let regrouped = EuroAmount.regroup(text)
        switch field {
        case .floorArea: form.floorArea = regrouped
        case .askingPrice: form.askingPrice = regrouped
        case .county, .eircode, .bedrooms, .propertyType, .berRating: break
        }
    }

    func increaseBedrooms() {
        guard canIncreaseBedrooms else { return }
        form.bedrooms += 1
    }

    func decreaseBedrooms() {
        guard canDecreaseBedrooms else { return }
        form.bedrooms -= 1
    }

    /// Checks the form, then asks the endpoint (Figma 10c Valuing, 10d Couldn't value). With errors it
    /// shows them all and sends nothing. While one check runs, another call does nothing, so an older
    /// answer can't replace a newer one.
    func check() async {
        guard !isValuing else { return }
        touched.formUnion(PropertyCheckField.allCases)
        guard let request = ValuationRequest(form: form) else { return }

        checkError = nil
        isValuing = true
        defer { isValuing = false }
        do {
            let answer = try await service.value(request)
            result = answer
            summary = ValuationSummary(request: request, result: answer)
        } catch let error as APIError {
            fail(with: Self.message(for: error))
        } catch {
            logger.error("Unexpected valuation error: \(error.localizedDescription, privacy: .public)")
            fail(with: Self.message(for: .unavailable))
        }
    }

    static func message(for error: APIError) -> String {
        switch error {
        case .network: "We couldn't value this property right now. Check your connection and try again."
        case .signedOut: "You've been signed out. Sign in again to check a property."
        case .unavailable: "We couldn't value this property right now. Try again in a moment."
        }
    }

    /// Shows the error and drops the earlier answer, so an old estimate doesn't sit next to it.
    private func fail(with message: String) {
        summary = nil
        checkError = message
    }
}
