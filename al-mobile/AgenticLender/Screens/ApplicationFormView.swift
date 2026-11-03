import SwiftUI

/// "Your application" (Figma frames "12 Application form" and 12a Above your maximum).
///
/// It reopens the borrower's saved Draft, and "Save draft" creates it the first time and changes it
/// after that. A saved mortgage Draft can then be reviewed and submitted; an Edit link on the review
/// comes back here, scrolled to its part. A submitted application opens read-only.
/// The home's details use the same controls as the HELOC check (Figma 07i).
struct ApplicationFormView: View {
    @State private var model: ApplicationViewModel
    @State private var isCountySheetShown = false
    @FocusState private var focused: ApplicationField?
    @State private var submitModel: ApplicationSubmitViewModel?
    /// Where the review's Edit link asked to land, scrolled to once the review has closed.
    @State private var editAnchor: ApplicationFormAnchor?
    @State private var savedChecks: SavedChecksStore
    /// Whether the property check opened from "Check a property" is showing.
    @State private var isCheckingProperty = false
    private let savedCheckService: SavedCheckService
    private let valuation: ValuationService
    /// Nil means the live one, made on the main actor when it's needed.
    private let profiles: ProfileService?
    private let service: ApplicationService
    private let onBackToHome: () -> Void

    init(
        form: ApplicationForm,
        service: ApplicationService = APIApplicationService.live(),
        draftIDs: DraftIDStore = liveDraftIDStore(),
        savedChecks: SavedCheckService = LiveSavedCheckService.live(),
        valuation: ValuationService = APIValuationService.live(),
        profiles: ProfileService? = nil,
        onBackToHome: @escaping () -> Void = {}
    ) {
        self.profiles = profiles
        self.savedCheckService = savedChecks
        self.valuation = valuation
        _model = State(initialValue: ApplicationViewModel(form: form, service: service, draftIDs: draftIDs))
        _savedChecks = State(initialValue: SavedChecksStore(service: savedChecks))
        self.service = service
        self.onBackToHome = onBackToHome
    }

    var body: some View {
        ScrollViewReader { proxy in
            formScroll
                .onChange(of: submitModel == nil) { _, isClosed in
                    guard isClosed, let anchor = editAnchor else { return }
                    editAnchor = nil
                    withAnimation { proxy.scrollTo(anchor, anchor: .top) }
                }
        }
        .navigationDestination(isPresented: isReviewing) {
            if let submitModel {
                ApplicationReviewView(
                    model: submitModel,
                    onEdit: { anchor in
                        editAnchor = anchor
                        self.submitModel = nil
                    },
                    onBackToHome: onBackToHome
                )
            }
        }
        .navigationDestination(isPresented: $isCheckingProperty) {
            PropertyCheckFormView(service: valuation, savedChecks: savedCheckService)
        }
    }

    private var isReviewing: Binding<Bool> {
        Binding(get: { submitModel != nil }, set: { if !$0 { submitModel = nil } })
    }

    private func openReview() {
        guard let target = model.reviewTarget else { return }
        submitModel = ApplicationSubmitViewModel(review: target.review, applicationID: target.applicationID, service: service)
    }

    private var formScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Your application")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                if let note = model.draftNote {
                    Label(note, systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(Theme.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Theme.neutral, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
                        .accessibilityIdentifier("application.draftNote")
                }

                affordabilityCard
                    .id(ApplicationFormAnchor.money)

                HStack(alignment: .top, spacing: 12) {
                    amountField("Monthly take-home pay", field: .monthlyTakeHome, placeholder: "3,650")
                    amountField("Monthly living costs", field: .monthlyLivingCosts, placeholder: "1,400")
                }
                VStack(alignment: .leading, spacing: 8) {
                    amountField(isHELOC ? "Credit line you want" : "Loan amount", field: .loanAmount,
                                placeholder: isHELOC ? "90,000" : "210,000")
                    if let warning = model.loanWarning {
                        LoanWarning(message: warning)
                    }
                }
                .id(ApplicationFormAnchor.loan)
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
                if isHELOC {
                    // The HELOC check takes one household income, so the form asks this itself.
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Applying").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                        SegmentedPicker(selection: $model.form.isJoint, options: [(false, "Single"), (true, "Joint")])
                            .accessibilityIdentifier("application.applicants")
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Employment").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                    SegmentedPicker(
                        selection: $model.form.employment,
                        options: ApplicationForm.Employment.allCases.map { ($0, $0.title) }
                    )
                }
                .id(ApplicationFormAnchor.employment)
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

                Group {
                    if isHELOC { helocHomeSection } else { propertySection }
                }
                .id(ApplicationFormAnchor.home)
            }
            .disabled(model.isFormLocked)
            .padding(Theme.screenPadding)
        }
        .task {
            await model.loadSavedDraft()
            if isHELOC { await fillHomeAddressFromProfile() }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { footer }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isCountySheetShown, onDismiss: { model.markTouched(.county) }) {
            CountySheet(selection: $model.form.property.county)
        }
        .onChange(of: focused) { previous, _ in
            if let previous { model.markTouched(previous) }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if model.isReadOnly {
            readOnlyFooter
        } else {
            saveFooter
        }
    }

    /// AC: a submitted application shows what was sent, with this note and no way to change it.
    private var readOnlyFooter: some View {
        Label(ApplicationViewModel.readOnlyNote, systemImage: "lock")
            .font(.footnote)
            .foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.screenPadding)
            .background(Theme.oat)
            .accessibilityIdentifier("application.readOnly")
    }

    private var saveFooter: some View {
        VStack(spacing: 8) {
            if model.isLoading {
                ProgressView("Loading your draft…")
                    .font(.footnote)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("application.loading")
            }
            if let error = model.loadError {
                HStack {
                    Label(error, systemImage: "exclamationmark.circle")
                        .foregroundStyle(Theme.error)
                    Button("Try again") { Task { await model.loadSavedDraft() } }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("application.retryLoad")
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("application.loadError")
            }
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
                title: model.isSaving ? "Saving..." : "Save draft",
                isLoading: model.isSaving,
                isEnabled: model.canSave
            ) {
                focused = nil
                Task { await model.save() }
            }
            .accessibilityIdentifier("application.save")
            if model.reviewTarget != nil {
                SecondaryButton(title: "Review and submit", action: openReview)
                    .accessibilityIdentifier("application.review")
            }
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    private var affordabilityCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.checkSummaryTitle)
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

    private var isHELOC: Bool { model.form.loanType == .heloc }

    /// A HELOC is against the home they live in, so its address starts as the profile's (AL-208).
    /// Anything typed or saved already stays; if the profile can't load, the fields stay empty.
    private func fillHomeAddressFromProfile() async {
        let service = profiles ?? FirebaseProfileService()
        guard let profile = try? await service.loadProfile() else { return }
        model.form = model.form.withHomeAddress(from: profile)
    }

    /// Figma 12c "Your home": the house the HELOC check valued, then its address. The house details
    /// come from the check (its Edit link goes back there), so only the address is typed here.
    private var helocHomeSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your home")
                .font(.title3.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 8)

            if let heloc = model.form.heloc {
                VStack(alignment: .leading, spacing: 4) {
                    Text(helocHomeTitle)
                        .font(.headline)
                        .foregroundStyle(Theme.text)
                    Text("Estimated value €\(EuroAmount.format(Int(heloc.homeValueEur.rounded())))")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Theme.mutedText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("application.helocHome")
            }

            textField("Address line 1", field: .addressLine1, text: $model.form.property.addressLine1,
                      placeholder: "4 Quay Street", contentType: .streetAddressLine1)
            FormField("Address line 2 (optional)", error: nil) {
                TextField("Area or estate", text: $model.form.property.addressLine2)
                    .textContentType(.streetAddressLine2)
                    .accessibilityIdentifier("application.addressLine2")
            }
            textField("Eircode", field: .eircode, text: $model.form.property.eircode,
                      placeholder: "T12 X5R2", contentType: .postalCode)
                .textInputAutocapitalization(.characters)
        }
    }

    /// "Cork semi-detached, 110 m²".
    private var helocHomeTitle: String {
        let property = model.form.property
        let name = property.county.flatMap { county in
            property.propertyType.map { ValuationSummary.title(county: county, propertyType: $0) }
        } ?? "Your home"
        return property.floorArea.isBlank ? name : "\(name), \(property.floorArea) m²"
    }

    /// The home being bought: address, Eircode, county, asking price, type, size, bedrooms and BER.
    private var propertySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("The home you're buying")
                .font(.title3.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 8)

            SavedCheckPicker(
                store: savedChecks,
                onPick: { check in model.form.property = model.form.property.filled(from: check) },
                onCheckProperty: { isCheckingProperty = true }
            )

            textField("Address line 1", field: .addressLine1, text: $model.form.property.addressLine1,
                      placeholder: "12 Model Farm Road", contentType: .streetAddressLine1)
            FormField("Address line 2 (optional)", error: nil) {
                TextField("Area or estate", text: $model.form.property.addressLine2)
                    .textContentType(.streetAddressLine2)
                    .accessibilityIdentifier("application.addressLine2")
            }
            HStack(alignment: .top, spacing: 12) {
                textField("Eircode", field: .eircode, text: $model.form.property.eircode,
                          placeholder: "T12 X8Y2", contentType: .postalCode)
                    .textInputAutocapitalization(.characters)
                FormField("County", error: model.visibleError(for: .county)) { countyButton }
            }
            amountField("Asking price", field: .askingPrice, placeholder: "380,000")
            FormField("Property type", error: model.visibleError(for: .propertyType)) {
                PropertyTypeMenu(selection: $model.form.property.propertyType) { model.markTouched(.propertyType) }
                    .accessibilityIdentifier("application.propertyType")
            }
            HStack(alignment: .top, spacing: 12) {
                amountField("Size", field: .floorArea, placeholder: "98", currency: false, unit: "m²")
                BedroomsStepper(
                    count: model.form.property.bedrooms,
                    error: model.visibleError(for: .bedrooms),
                    canDecrease: model.canDecreaseBedrooms,
                    canIncrease: model.canIncreaseBedrooms,
                    decrease: model.decreaseBedrooms,
                    increase: model.increaseBedrooms
                )
                .accessibilityIdentifier("application.bedrooms")
            }
            FormField("BER rating", error: model.visibleError(for: .berRating)) {
                BERMenu(selection: $model.form.property.berRating) { model.markTouched(.berRating) }
                    .accessibilityIdentifier("application.berRating")
            }
        }
    }

    private var countyButton: some View {
        Button {
            focused = nil
            isCountySheetShown = true
        } label: {
            PickerFieldLabel(value: model.form.property.county?.name, placeholder: "Choose county")
        }
        .accessibilityLabel("County, \(model.form.property.county?.name ?? "not chosen")")
        .accessibilityIdentifier("application.county")
    }

    private func textField(
        _ label: String,
        field: ApplicationField,
        text: Binding<String>,
        placeholder: String,
        contentType: UITextContentType
    ) -> some View {
        FormField(label, error: model.visibleError(for: field)) {
            TextField(placeholder, text: text)
                .textContentType(contentType)
                .autocorrectionDisabled()
                .focused($focused, equals: field)
                .accessibilityIdentifier("application.\(field)")
        }
    }

    /// A whole-number field: euro by default, or with a unit after it such as m².
    private func amountField(
        _ label: String,
        field: ApplicationField,
        placeholder: String,
        currency: Bool = true,
        unit: String? = nil
    ) -> some View {
        FormField(label, error: model.visibleError(for: field)) {
            HStack(spacing: 8) {
                if currency {
                    Text("€").foregroundStyle(Theme.mutedText)
                }
                TextField(placeholder, text: Binding(
                    get: { text(for: field) },
                    set: { model.updateAmount(field, to: $0) }
                ))
                .keyboardType(.numberPad)
                .focused($focused, equals: field)
                .accessibilityLabel("\(label), \(currency ? "in euro" : "in square metres")")
                .accessibilityIdentifier("application.\(field)")
                if let unit {
                    Text(unit).foregroundStyle(Theme.mutedText).accessibilityHidden(true)
                }
            }
        }
    }

    private func text(for field: ApplicationField) -> String {
        switch field {
        case .monthlyTakeHome: model.form.monthlyTakeHome
        case .monthlyLivingCosts: model.form.monthlyLivingCosts
        case .loanAmount: model.form.loanAmount
        case .askingPrice: model.form.property.askingPrice
        case .floorArea: model.form.property.floorArea
        case .addressLine1, .eircode, .county, .propertyType, .bedrooms, .berRating: ""
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
        ApplicationFormView(form: ApplicationForm(affordability: AffordabilityRequest(form: affordability)!, maxLoanEur: 240_000, loanType: .mortgage))
    }
}
