import SwiftUI

/// "What can I borrow?" (Figma frames "Affordability form", 07a Joint, 07b Errors,
/// 07c Calculating and 07d Couldn't calculate). Pushes the result screen once calculated.
struct AffordabilityFormView: View {
    @State private var model: AffordabilityViewModel
    @FocusState private var focused: AffordabilityField?

    init(service: AffordabilityService) {
        _model = State(initialValue: AffordabilityViewModel(service: service))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("What can I borrow?")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                SegmentedPicker(
                    selection: $model.form.applicants,
                    options: [(.single, "Single"), (.joint, "Joint")]
                )

                let isJoint = model.form.applicants == .joint
                amountField(isJoint ? "Your gross yearly income" : "Gross yearly income", field: .income, placeholder: "60,000")
                if isJoint {
                    amountField("Second applicant's gross yearly income", field: .secondIncome, placeholder: "45,000")
                }
                VStack(alignment: .leading, spacing: 6) {
                    amountField("Monthly debt repayments", field: .monthlyDebts, placeholder: "250")
                    if model.visibleError(for: .monthlyDebts) == nil {
                        Text("Car loans, credit cards, other loans. Enter 0 if none.")
                            .font(.footnote)
                            .foregroundStyle(Theme.mutedText)
                    }
                }
                amountField("Deposit saved", field: .deposit, placeholder: "30,000")
                termStepper
                Toggle(isJoint ? "First-time buyers" : "First-time buyer", isOn: $model.form.isFirstTimeBuyer)
                    .tint(Theme.pine)
                    .foregroundStyle(Theme.text)
                    .accessibilityIdentifier("affordability.firstTimeBuyer")
            }
            .padding(Theme.screenPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 12) {
                if let error = model.calculationError {
                    CalculationErrorBanner(message: error)
                }
                if let hint = model.calculateHint {
                    Text(hint)
                        .font(.footnote)
                        .foregroundStyle(Theme.mutedText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("affordability.calculateHint")
                }
                PrimaryButton(
                    title: calculateTitle,
                    isLoading: model.isCalculating,
                    isEnabled: model.canCalculate
                ) {
                    focused = nil
                    Task { await model.calculate() }
                }
                .accessibilityHint(model.calculateHint ?? "")
                .accessibilityIdentifier("affordability.calculate")
            }
            .padding(Theme.screenPadding)
            .background(Theme.oat)
        }
        .navigationDestination(item: $model.outcome) { outcome in
            AffordabilityResultView(outcome: outcome)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
    }

    private var calculateTitle: String {
        if model.isCalculating { return "Calculating…" }
        return model.calculationError == nil ? "Calculate" : "Try again"
    }

    private func amountField(_ label: String, field: AffordabilityField, placeholder: String) -> some View {
        FormField(label, error: model.visibleError(for: field)) {
            HStack(spacing: 8) {
                Text("€").foregroundStyle(Theme.mutedText)
                TextField(placeholder, text: Binding(
                    get: { text(for: field) },
                    set: { model.updateAmount(field, to: $0) }
                ))
                .keyboardType(.numberPad)
                .focused($focused, equals: field)
                .accessibilityLabel("\(label), in euro")
                .accessibilityIdentifier("affordability.\(field)")
            }
        }
    }

    private func text(for field: AffordabilityField) -> String {
        switch field {
        case .income: model.form.income
        case .secondIncome: model.form.secondIncome
        case .monthlyDebts: model.form.monthlyDebts
        case .deposit: model.form.deposit
        case .term: ""
        }
    }

    private var termStepper: some View {
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
}

/// Why the last calculation failed, above the Try again button (Figma 07d).
private struct CalculationErrorBanner: View {
    let message: String

    var body: some View {
        Label {
            Text(message)
        } icon: {
            Image(systemName: "exclamationmark.circle")
        }
        .font(.footnote)
        .foregroundStyle(Theme.error)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.error.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .accessibilityIdentifier("affordability.calculationError")
    }
}

#Preview {
    NavigationStack { AffordabilityFormView(service: APIAffordabilityService.live()) }
}
