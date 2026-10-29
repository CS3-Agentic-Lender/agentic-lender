import SwiftUI

/// "Check your application" (Figma 13 Review and 13a Confirm), then "Application submitted" (13b).
///
/// Each card's Edit link goes back to its part of the form. Submit asks for confirmation; cancelling
/// leaves the application a Draft.
struct ApplicationReviewView: View {
    @State private var model: ApplicationSubmitViewModel
    private let onEdit: (ApplicationFormAnchor) -> Void
    private let onBackToHome: () -> Void

    init(
        model: ApplicationSubmitViewModel,
        onEdit: @escaping (ApplicationFormAnchor) -> Void,
        onBackToHome: @escaping () -> Void
    ) {
        _model = State(initialValue: model)
        self.onEdit = onEdit
        self.onBackToHome = onBackToHome
    }

    var body: some View {
        Group {
            if let reference = model.reference {
                ApplicationSubmittedView(reference: reference, applicationID: model.applicationID, onBackToHome: onBackToHome)
            } else {
                review
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.reference != nil || model.isSubmitting)
    }

    private var review: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Check your application")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                ForEach(model.review.cards, id: \.section) { card in
                    ReviewCard(card: card) { onEdit(card.section.formAnchor) }
                        .disabled(model.isSubmitting)
                }
            }
            .padding(Theme.screenPadding)
        }
        .safeAreaInset(edge: .bottom) { footer }
        .alert("Submit your application?", isPresented: confirming) {
            Button("Cancel", role: .cancel) { model.cancelSubmit() }
            Button("Submit") { Task { await model.confirmSubmit() } }
        } message: {
            Text("The AI credit committee starts reviewing it straight away, so it can't be changed after this.")
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let error = model.submitError {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("review.submitError")
            }
            PrimaryButton(
                title: model.isSubmitting ? "Submitting..." : "Submit application",
                isLoading: model.isSubmitting,
                isEnabled: model.canSubmit
            ) {
                model.requestSubmit()
            }
            .accessibilityIdentifier("review.submit")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    /// The alert reads the model's state; dismissing it any other way counts as Cancel.
    private var confirming: Binding<Bool> {
        Binding(
            get: { model.isConfirming },
            set: { if !$0 { model.cancelSubmit() } }
        )
    }
}

/// One card of the review: its title, an Edit link, and a label and value per field.
private struct ReviewCard: View {
    let card: ApplicationReview.Card
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(card.section.title)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Edit", action: edit)
                    .font(.subheadline.weight(.semibold))
                    .frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget, alignment: .trailing)
                    .accessibilityLabel("Edit \(card.section.title.lowercased())")
                    .accessibilityIdentifier("review.edit.\(card.section)")
            }
            ForEach(card.rows, id: \.self) { row in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(row.label)
                        .foregroundStyle(Theme.mutedText)
                    Spacer(minLength: 8)
                    Text(row.value)
                        .multilineTextAlignment(.trailing)
                }
                .font(.subheadline)
                .accessibilityElement(children: .combine)
            }
        }
        .foregroundStyle(Theme.text)
        .padding(Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
    }
}

/// "Application submitted" (Figma 13b) with its reference, and the way to its status timeline.
private struct ApplicationSubmittedView: View {
    let reference: ApplicationReference
    let applicationID: String
    let onBackToHome: () -> Void
    @State private var isShowingStatus = false

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "checkmark")
                .font(.title.weight(.semibold))
                .foregroundStyle(Theme.success)
                .frame(width: 72, height: 72)
                .background(Theme.tint)
                .clipShape(Circle())
                .accessibilityHidden(true)
            Text("Application submitted")
                .font(.title.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text("Ref \(reference.text)")
                .font(.system(.body, design: .monospaced).weight(.semibold))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Theme.tint)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .accessibilityLabel("Reference \(reference.text.map(String.init).joined(separator: " "))")
                .accessibilityIdentifier("submitted.reference")
            Text("The AI credit committee is reviewing it now. Your broker can see it too.")
                .font(.body)
                .foregroundStyle(Theme.mutedText)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(Theme.screenPadding)
        .frame(maxWidth: .infinity)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 12) {
                PrimaryButton(title: "View status") { isShowingStatus = true }
                    .accessibilityIdentifier("submitted.viewStatus")
                SecondaryButton(title: "Back to home", action: onBackToHome)
                    .accessibilityIdentifier("submitted.backToHome")
            }
            .padding(Theme.screenPadding)
        }
        .navigationDestination(isPresented: $isShowingStatus) {
            ApplicationStatusView(applicationID: applicationID, service: FirestoreApplicationStatusService())
        }
    }
}

#Preview {
    let review = ApplicationReview(form: {
        var affordability = AffordabilityForm()
        affordability.income = "60,000"
        affordability.monthlyDebts = "250"
        affordability.deposit = "30,000"
        var form = ApplicationForm(affordability: AffordabilityRequest(form: affordability)!, maxLoanEur: 240_000, loanType: .mortgage)
        form.loanAmount = "210,000"
        form.monthlyTakeHome = "3,650"
        form.monthlyLivingCosts = "1,400"
        form.property = ApplicationProperty(addressLine1: "12 Model Farm Road", eircode: "T12 X8Y2", county: .cork,
                                            askingPrice: "380,000", propertyType: .semiDetached, bedrooms: 3,
                                            floorArea: "98", berRating: .c2)
        return form
    }())!
    return NavigationStack {
        ApplicationReviewView(
            model: ApplicationSubmitViewModel(review: review, applicationID: "7f3k9qx2", service: APIApplicationService.live()),
            onEdit: { _ in },
            onBackToHome: {}
        )
    }
}
