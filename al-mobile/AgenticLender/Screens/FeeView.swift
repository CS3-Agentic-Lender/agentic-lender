import StripePaymentSheet
import SwiftUI

/// Fast-track appraisal (AL-148, Figma 16 to 18b): what it gets the borrower and its €150 price, Pay in
/// Stripe's payment sheet, then "Confirming your payment" until al-core's webhook marks the fee paid,
/// and the receipt. Only the publishable test key is in the app.
struct FeeView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: FeeViewModel
    /// The application's live status, which carries the fee the webhook writes.
    let status: ApplicationStatusViewModel
    let brokerName: String?

    init(status: ApplicationStatusViewModel, brokerName: String?, service: FeeService, publishableKey: String?) {
        self.status = status
        self.brokerName = brokerName
        _model = State(initialValue: FeeViewModel(applicationID: status.id, service: service, publishableKey: publishableKey))
    }

    var body: some View {
        Group {
            switch model.state {
            case .confirming(let stillWaiting): confirming(stillWaiting: stillWaiting)
            case .receipt(let receipt): FeeReceiptView(receipt: receipt, reference: status.reference)
            case .decided: decided
            default: offer
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { TestModeBadge() } }
        .paymentSheet(isPresented: sheetShown, paymentSheet: paymentSheet ?? Self.placeholderSheet) { result in
            model.sheetFinished(Self.result(result))
            model.feeChanged(status.fee) // the webhook may already have landed
        }
        .onChange(of: status.fee) { _, fee in model.feeChanged(fee) }
        .onChange(of: status.feeSection, initial: true) { _, section in model.offerChanged(section) }
        .task(id: model.state) {
            guard model.state == .confirming(stillWaiting: false) else { return }
            try? await Task.sleep(for: .seconds(FeeViewModel.confirmingSeconds))
            model.waitedTooLong()
        }
    }

    // MARK: - Figma 16 and 16b

    private var offer: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Fast-track appraisal").font(.largeTitle.bold()).foregroundStyle(Theme.text).accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 14) {
                    benefit("calendar", "A valuer visits within 5 working days")
                    benefit("doc.text", "The valuation goes straight into your application")
                    benefit("person.2", "\(brokerName ?? "Your broker") is told as soon as you pay")
                    benefit("arrow.up.to.line", "Your application moves to the top of the underwriter's queue")
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("One-off fee").font(.footnote).foregroundStyle(Theme.mutedText)
                    Text(FeeReceipt(amountEur: ApplicationFee.amountEur, paidAt: nil, paymentIntentID: "").amountText)
                        .font(.system(.largeTitle, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Theme.text)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
            }
            .padding(Theme.screenPadding)
        }
        .safeAreaInset(edge: .bottom) { footer }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if case .failed(let message) = model.state {
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.dangerBadge, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
                    .accessibilityIdentifier("fee.failed")
            }
            PrimaryButton(title: payTitle, isLoading: model.isStarting) { Task { await model.pay() } }
                .accessibilityIdentifier("fee.pay")
            Button("Not now") { dismiss() }
                .font(.headline)
                .foregroundStyle(Theme.text)
                .frame(minHeight: Theme.minTapTarget)
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    private var payTitle: String {
        if case .failed = model.state { return "Try again" }
        return "Pay \(FeeReceipt(amountEur: ApplicationFee.amountEur, paidAt: nil, paymentIntentID: "").amountText)"
    }

    private func benefit(_ symbol: String, _ text: String) -> some View {
        Label {
            Text(text).font(.body).foregroundStyle(Theme.text)
        } icon: {
            // A fixed width so every line's text starts in the same place (Figma 16).
            Image(systemName: symbol).foregroundStyle(Theme.text).frame(width: 24).accessibilityHidden(true)
        }
    }

    // MARK: - Figma 18b

    private func confirming(stillWaiting: Bool) -> some View {
        VStack(spacing: 12) {
            ProgressView().tint(Theme.pine).controlSize(.large)
            Text("Confirming your payment").font(.title2.bold()).foregroundStyle(Theme.text)
            Text("This usually takes a few seconds.").font(.body).foregroundStyle(Theme.mutedText)
            if stillWaiting {
                Text("Still waiting. You won't be charged twice.").font(.body).foregroundStyle(Theme.text).padding(.top, 8)
                SecondaryButton(title: "Check again") { status.retry() }
                    .accessibilityIdentifier("fee.checkAgain")
            }
        }
        .multilineTextAlignment(.center)
        .padding(Theme.screenPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("fee.confirming")
    }

    // MARK: - Decided before the fee was paid (no Figma frame)

    private var decided: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.seal").font(.largeTitle).foregroundStyle(Theme.pine).accessibilityHidden(true)
            Text("Fast-track no longer applies").font(.title2.bold()).foregroundStyle(Theme.text)
            Text(FeeViewModel.decidedMessage).font(.body).foregroundStyle(Theme.mutedText)
            SecondaryButton(title: "Done") { dismiss() }
                .padding(.top, 8)
                .accessibilityIdentifier("fee.decidedDone")
        }
        .multilineTextAlignment(.center)
        .padding(Theme.screenPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("fee.decided")
    }

    // MARK: - Stripe

    private var sheetShown: Binding<Bool> {
        Binding(
            get: { if case .sheet = model.state { true } else { false } },
            set: { shown in if !shown, case .sheet = model.state { model.sheetFinished(.canceled) } }
        )
    }

    private var paymentSheet: PaymentSheet? {
        guard case .sheet(let intent) = model.state, let key = model.publishableKey else { return nil }
        STPAPIClient.shared.publishableKey = key
        return PaymentSheet(paymentIntentClientSecret: intent.clientSecret, configuration: Self.configuration)
    }

    /// Pine & Oat on Stripe's sheet (Figma 17: "styled with the app's colours").
    private static var configuration: PaymentSheet.Configuration {
        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = "Agentic Lender"
        configuration.defaultBillingDetails.address.country = "IE"
        var appearance = PaymentSheet.Appearance()
        appearance.colors.primary = UIColor(Theme.pine)
        appearance.colors.background = UIColor(Theme.surface)
        appearance.colors.componentBorder = UIColor(Theme.line)
        appearance.colors.danger = UIColor(Theme.error)
        appearance.primaryButton.backgroundColor = UIColor(Theme.pine)
        appearance.cornerRadius = Theme.cornerRadius
        configuration.appearance = appearance
        return configuration
    }

    /// Never shown: `sheetShown` is only true while there's a real intent.
    private static let placeholderSheet = PaymentSheet(paymentIntentClientSecret: "pi_unused_secret_unused", configuration: configuration)

    private static func result(_ result: PaymentSheetResult) -> FeeSheetResult {
        switch result {
        case .completed: .completed
        case .canceled: .canceled
        case .failed: .failed
        }
    }
}

/// "Test mode" in the corner of every payment screen (Figma 16 to 18).
private struct TestModeBadge: View {
    var body: some View {
        Text("Test mode")
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.pine)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Theme.tint, in: Capsule())
    }
}
