import SwiftUI

/// "What can I borrow?" (Figma frames "Affordability form", 07a Joint and 07b Errors).
struct AffordabilityFormView: View {
    @State private var model = AffordabilityViewModel()
    @FocusState private var focused: AffordabilityField?
    let onCalculate: (AffordabilityRequest) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("What can I borrow?")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                ApplicantsPicker(selection: $model.form.applicants)

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
            PrimaryButton(title: "Calculate", isEnabled: model.canCalculate) {
                focused = nil
                if let request = model.calculate() { onCalculate(request) }
            }
            .accessibilityIdentifier("affordability.calculate")
            .padding(Theme.screenPadding)
            .background(Theme.oat)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
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
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Term").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                Text("\(model.form.termYears) years")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Theme.text)
            }
            Spacer()
            StepButton(systemImage: "minus", label: "Shorter term", isEnabled: model.canDecreaseTerm) { model.decreaseTerm() }
            StepButton(systemImage: "plus", label: "Longer term", isEnabled: model.canIncreaseTerm) { model.increaseTerm() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Term")
        .accessibilityValue("\(model.form.termYears) years")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: model.increaseTerm()
            case .decrement: model.decreaseTerm()
            @unknown default: break
            }
        }
    }
}

/// The Single / Joint switch, styled like the Figma segmented control.
private struct ApplicantsPicker: View {
    @Binding var selection: AffordabilityForm.Applicants

    var body: some View {
        HStack(spacing: 0) {
            segment("Single", value: .single)
            segment("Joint", value: .joint)
        }
        .padding(3)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
    }

    private func segment(_ title: String, value: AffordabilityForm.Applicants) -> some View {
        let isSelected = selection == value
        return Button {
            selection = value
        } label: {
            Text(title)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? Theme.text : Theme.mutedText)
                .frame(maxWidth: .infinity, minHeight: 34)
                .background(isSelected ? Theme.surface : .clear)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius - 2))
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A 44-point square − / + button for the term.
private struct StepButton: View {
    let systemImage: String
    let label: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.headline)
                .frame(width: 44, height: 44)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
        }
        .foregroundStyle(isEnabled ? Theme.text : Theme.mutedText)
        .disabled(!isEnabled)
        .accessibilityLabel(label)
    }
}

#Preview {
    NavigationStack { AffordabilityFormView(onCalculate: { _ in }) }
}
