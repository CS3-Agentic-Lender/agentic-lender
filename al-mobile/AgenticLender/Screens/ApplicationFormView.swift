import SwiftUI

/// "Your application" (Figma frames "12 Application form" and 12a Above your maximum).
///
/// "Save draft" saves it through `POST /core/applications`. The property row waits on the team's
/// decision about the property in Sprint 1, and reviewing and submitting is the next step.
struct ApplicationFormView: View {
    @State private var model: ApplicationViewModel
    @FocusState private var focused: ApplicationField?

    init(form: ApplicationForm, service: ApplicationService = APIApplicationService.live()) {
        _model = State(initialValue: ApplicationViewModel(form: form, service: service))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Your application")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                affordabilityCard

                HStack(alignment: .top, spacing: 12) {
                    amountField("Monthly take-home pay", field: .monthlyTakeHome, placeholder: "3,650")
                    amountField("Monthly living costs", field: .monthlyLivingCosts, placeholder: "1,400")
                }
                VStack(alignment: .leading, spacing: 8) {
                    amountField("Loan amount", field: .loanAmount, placeholder: "210,000")
                    if let warning = model.loanWarning {
                        LoanWarning(message: warning)
                    }
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
                VStack(alignment: .leading, spacing: 6) {
                    Text("Employment").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                    SegmentedPicker(
                        selection: $model.form.employment,
                        options: ApplicationForm.Employment.allCases.map { ($0, $0.title) }
                    )
                }
                StepperRow(
                    label: "Years in current job",
                    value: "\(model.form.yearsInCurrentJob) years",
                    decreaseLabel: "Fewer years",
                    increaseLabel: "More years",
                    canDecrease: model.canDecreaseYearsInJob,
                    canIncrease: model.canIncreaseYearsInJob,
                    decrease: model.decreaseYearsInJob,
                    increase: model.increaseYearsInJob
                )
            }
            .padding(Theme.screenPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { footer }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let error = model.saveError {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("application.saveError")
            }
            if let message = model.saveMessage {
                Label(message, systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.success)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("application.saved")
            }
            PrimaryButton(
                title: model.isSaving ? "Saving..." : (model.isSaved ? "Saved" : "Save draft"),
                isLoading: model.isSaving,
                isEnabled: model.canSave
            ) {
                focused = nil
                Task { await model.save() }
            }
            .accessibilityIdentifier("application.save")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    private var affordabilityCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("From your affordability check")
                .font(.footnote.weight(.semibold))
            Text(model.affordabilitySummary)
                .font(.system(.footnote, design: .monospaced))
                .accessibilityIdentifier("application.affordabilitySummary")
        }
        .foregroundStyle(Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .accessibilityElement(children: .combine)
    }

    private func amountField(_ label: String, field: ApplicationField, placeholder: String) -> some View {
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
                .accessibilityIdentifier("application.\(field)")
            }
        }
    }

    private func text(for field: ApplicationField) -> String {
        switch field {
        case .monthlyTakeHome: model.form.monthlyTakeHome
        case .monthlyLivingCosts: model.form.monthlyLivingCosts
        case .loanAmount: model.form.loanAmount
        }
    }
}

/// The above-maximum note under the loan amount (Figma 12a). A warning, not an error.
private struct LoanWarning: View {
    let message: String

    var body: some View {
        Label {
            Text(message)
        } icon: {
            Image(systemName: "exclamationmark.triangle")
        }
        .font(.footnote)
        .foregroundStyle(Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .accessibilityIdentifier("application.loanWarning")
    }
}

#Preview {
    var affordability = AffordabilityForm()
    affordability.income = "60,000"
    affordability.monthlyDebts = "250"
    affordability.deposit = "30,000"
    return NavigationStack {
        ApplicationFormView(form: ApplicationForm(affordability: AffordabilityRequest(form: affordability)!, maxLoanEur: 240_000))
    }
}
