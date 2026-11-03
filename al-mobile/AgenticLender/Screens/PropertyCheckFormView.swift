import SwiftUI

/// "Check a property" (Figma frames 10 Specs form, 10a Errors, 10b BER sheet, 10c Valuing and
/// 10d Couldn't value). Check value sends the home's details to the valuation endpoint and
/// shows the result screen.
struct PropertyCheckFormView: View {
    @State private var model: PropertyCheckViewModel
    @State private var isCountySheetShown = false
    @FocusState private var focused: PropertyCheckField?

    private let savedChecks: SavedCheckService?

    init(service: ValuationService, savedChecks: SavedCheckService? = nil) {
        _model = State(initialValue: PropertyCheckViewModel(service: service))
        self.savedChecks = savedChecks
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Check a property")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                FormField("County", error: model.visibleError(for: .county)) { countyButton }

                FormField("Eircode", error: model.visibleError(for: .eircode)) {
                    TextField("A65 F4E2", text: $model.form.eircode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .focused($focused, equals: .eircode)
                        .accessibilityIdentifier("propertyCheck.eircode")
                }

                HStack(alignment: .top, spacing: 12) {
                    numberField("Size", field: .floorArea, placeholder: "110", unit: "m²", accessibilityUnit: "in square metres")
                    bedroomsStepper
                }

                HStack(alignment: .top, spacing: 12) {
                    FormField("Property type", error: model.visibleError(for: .propertyType)) {
                        PropertyTypeMenu(selection: $model.form.propertyType) { model.markTouched(.propertyType) }
                            .accessibilityIdentifier("propertyCheck.propertyType")
                    }
                    FormField("BER rating", error: model.visibleError(for: .berRating)) {
                        BERMenu(selection: $model.form.berRating, groups: BERRating.valuationGroups) {
                            model.markTouched(.berRating)
                        }
                        .accessibilityIdentifier("propertyCheck.berRating")
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    numberField(
                        "Asking price (optional)", field: .askingPrice, placeholder: "379,000",
                        currency: true, accessibilityUnit: "in euro"
                    )
                    Text("Add it to see if the price is fair")
                        .font(.footnote)
                        .foregroundStyle(Theme.mutedText)
                }
            }
            .padding(Theme.screenPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { footer }
        .navigationDestination(item: $model.summary) { summary in
            ValuationResultView(summary: summary, draft: model.savedCheckDraft, savedChecks: savedChecks)
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
            PickerFieldLabel(value: model.form.county?.name, placeholder: "Choose a county")
        }
        .accessibilityLabel("County, \(model.form.county?.name ?? "not chosen")")
        .accessibilityIdentifier("propertyCheck.county")
    }

    /// Check value, with why it's off or why the last try failed (Figma 10a and 10d).
    private var footer: some View {
        VStack(spacing: 12) {
            if let error = model.checkError {
                CalculationErrorBanner(message: error, identifier: "propertyCheck.checkError")
            }
            if let hint = model.checkHint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(Theme.mutedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("propertyCheck.checkHint")
            }
            PrimaryButton(title: checkTitle, isLoading: model.isValuing, isEnabled: model.canCheck) {
                focused = nil
                Task { await model.check() }
            }
            .accessibilityHint(model.checkHint ?? "")
            .accessibilityIdentifier("propertyCheck.check")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    private var checkTitle: String {
        if model.isValuing { return "Valuing…" }
        return model.checkError == nil ? "Check value" : "Try again"
    }

    private var bedroomsStepper: some View {
        BedroomsStepper(
            count: model.form.bedrooms,
            error: nil,
            canDecrease: model.canDecreaseBedrooms,
            canIncrease: model.canIncreaseBedrooms,
            decrease: model.decreaseBedrooms,
            increase: model.increaseBedrooms
        )
        .accessibilityIdentifier("propertyCheck.bedrooms")
    }

    private func numberField(
        _ label: String,
        field: PropertyCheckField,
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
                    text: field == .floorArea ? model.form.floorArea : model.form.askingPrice,
                    onEdit: { model.updateText(field, to: $0) }
                )
                .keyboardType(.numberPad)
                .focused($focused, equals: field)
                .accessibilityLabel("\(label), \(accessibilityUnit)")
                .accessibilityIdentifier("propertyCheck.\(field)")
                if let unit {
                    Text(unit).foregroundStyle(Theme.mutedText).accessibilityHidden(true)
                }
            }
        }
    }
}

#if DEBUG
private struct PreviewValuationService: ValuationService {
    func value(_ request: ValuationRequest) async throws -> ValuationResult {
        ValuationResult(
            estimateEur: 371_800, displayEstimateEur: 372_000, basis: "2024 asking-price estimate",
            supportWarnings: [], askingPriceGap: 0.0221, priceNeedsReview: false, modelVersion: "v2",
            baselineEur: nil, contributions: nil
        )
    }
}

#Preview {
    NavigationStack { PropertyCheckFormView(service: PreviewValuationService()) }
}
#endif
