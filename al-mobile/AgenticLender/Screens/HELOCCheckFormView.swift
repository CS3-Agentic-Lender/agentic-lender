import SwiftUI

/// "What can I borrow?" for a home equity line of credit (Figma frames 07i HELOC check and 07j Error).
///
/// Property type, Calculate and the result join once Nic sends the property types (AL-60) and
/// the HELOC request shape (AL-198).
struct HELOCCheckFormView: View {
    @State private var model = HELOCCheckViewModel()
    @State private var isCountySheetShown = false
    @FocusState private var focused: HELOCCheckField?

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

                HStack(alignment: .top, spacing: 12) {
                    numberField("Size", field: .floorArea, placeholder: "110", unit: "m²", accessibilityUnit: "in square metres")
                    bedroomsStepper
                }

                FormField("BER rating", error: model.visibleError(for: .berRating)) { berMenu }

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
            pickerLabel(model.form.county?.name, placeholder: "Choose county")
        }
        .accessibilityLabel("County, \(model.form.county?.name ?? "not chosen")")
        .accessibilityIdentifier("helocCheck.county")
    }

    private var berMenu: some View {
        Menu {
            Picker("BER rating", selection: Binding(
                get: { model.form.berRating },
                set: { model.form.berRating = $0; model.markTouched(.berRating) }
            )) {
                ForEach(BERRating.allCases) { rating in
                    Text(rating.title).tag(Optional(rating))
                }
            }
        } label: {
            pickerLabel(model.form.berRating?.title, placeholder: "Choose rating")
        }
        .accessibilityLabel("BER rating, \(model.form.berRating?.title ?? "not chosen")")
        .accessibilityIdentifier("helocCheck.berRating")
    }

    /// The text and chevron inside a picker field (Figma 07i County and BER rating).
    private func pickerLabel(_ value: String?, placeholder: String) -> some View {
        HStack {
            Text(value ?? placeholder)
                .foregroundStyle(value == nil ? Theme.mutedText : Theme.text)
            Spacer()
            Image(systemName: "chevron.down")
                .foregroundStyle(Theme.mutedText)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
        .contentShape(Rectangle())
    }

    /// Bedrooms with − / + either side of the count (Figma 07i).
    private var bedroomsStepper: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Bedrooms")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.text)
            HStack {
                StepButton(systemImage: "minus", label: "Fewer bedrooms", isEnabled: model.canDecreaseBedrooms, action: model.decreaseBedrooms)
                Text("\(model.form.bedrooms)")
                    .font(.body.monospacedDigit())
                    .foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity)
                StepButton(systemImage: "plus", label: "More bedrooms", isEnabled: true, action: model.increaseBedrooms)
            }
            .frame(minHeight: Theme.fieldHeight)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Bedrooms")
        .accessibilityValue("\(model.form.bedrooms)")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: model.increaseBedrooms()
            case .decrement: model.decreaseBedrooms()
            @unknown default: break
            }
        }
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
                TextField(placeholder, text: Binding(
                    get: { text(for: field) },
                    set: { model.updateText(field, to: $0) }
                ))
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
        case .county, .berRating, .term: ""
        }
    }
}

#Preview {
    NavigationStack { HELOCCheckFormView() }
}
