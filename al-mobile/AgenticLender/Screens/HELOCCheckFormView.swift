import SwiftUI

/// "What can I borrow?" for a home equity line of credit (Figma frames 07i HELOC check and 07j Error).
/// Calculate sends the house details to the affordability endpoint, which values the home itself.
struct HELOCCheckFormView: View {
    @State private var model: HELOCCheckViewModel
    @State private var isCountySheetShown = false
    @FocusState private var focused: HELOCCheckField?

    init(service: HELOCService) {
        _model = State(initialValue: HELOCCheckViewModel(service: service))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What can I borrow?")
                        .font(.largeTitle.bold())
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("Home equity line of credit")
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                }

                FormField("County", error: model.visibleError(for: .county)) { countyButton }

                FormField("Property type", error: model.visibleError(for: .propertyType)) {
                    PropertyTypeMenu(selection: $model.form.propertyType) { model.markTouched(.propertyType) }
                        .accessibilityIdentifier("helocCheck.propertyType")
                }

                HStack(alignment: .top, spacing: 12) {
                    numberField("Size", field: .floorArea, placeholder: "110", unit: "m²", accessibilityUnit: "in square metres")
                    bedroomsStepper
                }

                FormField("BER rating", error: model.visibleError(for: .berRating)) {
                    BERMenu(selection: $model.form.berRating) { model.markTouched(.berRating) }
                        .accessibilityIdentifier("helocCheck.berRating")
                }

                numberField(
                    "Balance left on your mortgage", field: .mortgageBalance, placeholder: "150,000",
                    currency: true, accessibilityUnit: "in euro"
                )

                HStack(alignment: .top, spacing: 12) {
                    numberField("Gross yearly income", field: .income, placeholder: "70,000", currency: true, accessibilityUnit: "in euro")
                    numberField("Monthly debts", field: .monthlyDebts, placeholder: "300", currency: true, accessibilityUnit: "in euro")
                }

                StepperRow(
                    label: "Term",
                    value: "\(model.form.termYears) years",
                    decreaseLabel: "Shorter term",
                    increaseLabel: "Longer term",
                    canDecrease: model.canDecreaseTerm,
                    canIncrease: model.canIncreaseTerm,
                    decrease: model.decreaseTerm,
                    increase: model.increaseTerm
                )
            }
            .padding(Theme.screenPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { footer }
        .navigationDestination(item: $model.result) { result in
            HELOCResultView(result: result, termYears: model.form.termYears, applicationForm: model.applicationForm())
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isCountySheetShown, onDismiss: { model.markTouched(.county) }) {
            CountySheet(selection: $model.form.county)
        }
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
    }

    private var countyButton: some View {
        Button {
            focused = nil
            isCountySheetShown = true
        } label: {
            PickerFieldLabel(value: model.form.county?.name, placeholder: "Choose county")
        }
        .accessibilityLabel("County, \(model.form.county?.name ?? "not chosen")")
        .accessibilityIdentifier("helocCheck.county")
    }

    /// Calculate, with why it's off or why the last try failed (Figma 07c and 07d).
    private var footer: some View {
        VStack(spacing: 12) {
            if let error = model.calculationError {
                CalculationErrorBanner(message: error, identifier: "helocCheck.calculationError")
            }
            if let hint = model.calculateHint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(Theme.mutedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("helocCheck.calculateHint")
            }
            PrimaryButton(title: calculateTitle, isLoading: model.isCalculating, isEnabled: model.canCalculate) {
                focused = nil
                Task { await model.calculate() }
            }
            .accessibilityHint(model.calculateHint ?? "")
            .accessibilityIdentifier("helocCheck.calculate")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    private var calculateTitle: String {
        if model.isCalculating { return "Calculating…" }
        return model.calculationError == nil ? "Calculate" : "Try again"
    }

    private var bedroomsStepper: some View {
        BedroomsStepper(
            count: model.form.bedrooms,
            error: nil,
            canDecrease: model.canDecreaseBedrooms,
            canIncrease: true,
            decrease: model.decreaseBedrooms,
            increase: model.increaseBedrooms
        )
        .accessibilityIdentifier("helocCheck.bedrooms")
    }

    private func numberField(
        _ label: String,
        field: HELOCCheckField,
        placeholder: String,
        currency: Bool = false,
        unit: String? = nil,
        accessibilityUnit: String
    ) -> some View {
        FormField(label, error: model.visibleError(for: field)) {
            HStack(spacing: 8) {
                if currency {
                    Text("€").foregroundStyle(Theme.mutedText)
                }
                AmountTextField(
                    placeholder: placeholder,
                    text: text(for: field),
                    onEdit: { model.updateText(field, to: $0) }
                )
                .keyboardType(.numberPad)
                .focused($focused, equals: field)
                .accessibilityLabel("\(label), \(accessibilityUnit)")
                .accessibilityIdentifier("helocCheck.\(field)")
                if let unit {
                    Text(unit).foregroundStyle(Theme.mutedText).accessibilityHidden(true)
                }
            }
        }
    }

    private func text(for field: HELOCCheckField) -> String {
        switch field {
        case .floorArea: model.form.floorArea
        case .mortgageBalance: model.form.mortgageBalance
        case .income: model.form.income
        case .monthlyDebts: model.form.monthlyDebts
        case .county, .propertyType, .berRating, .term: ""
        }
    }
}

#if DEBUG
private struct PreviewHELOCService: HELOCService {
    func checkHELOC(_ request: HELOCRequest) async throws -> HELOCResult {
        HELOCResult(
            homeValueEur: 262_353.72, maxLineEur: 59_882.97, combinedLtv: 0.8, monthlyRepaymentEur: 362.88,
            stressedRepaymentEur: 429.02, limitedBy: .equity, benchmarkRatePct: 4.0, stressedRatePct: 6.0, rateDate: "2026-08"
        )
    }
}

#Preview {
    NavigationStack { HELOCCheckFormView(service: PreviewHELOCService()) }
}
#endif
