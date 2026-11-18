import Foundation
import Observation
import os

/// What the payment sheet reported when it closed. Stripe shows a declined card inside the sheet
/// itself (Figma 17b), so a decline isn't a result here: the borrower tries another card there.
enum FeeSheetResult: Equatable {
    case completed
    case canceled
    /// The sheet couldn't take the payment; `reason` is Stripe's own message, for the log only.
    case failed(reason: String)
}

/// The receipt once al-core's webhook has marked the fee paid (Figma 18).
struct FeeReceipt: Equatable, Sendable {
    let amountEur: Int
    let paidAt: Date?
    let paymentIntentID: String

    /// "€150.00".
    var amountText: String {
        Double(amountEur).formatted(.currency(code: "EUR").precision(.fractionLength(2)).locale(Locale(identifier: "en_IE")))
    }

    /// "pi_…3xYz": enough to quote to support without the whole id.
    var shortReference: String {
        "pi_…\(paymentIntentID.suffix(4))"
    }
}

/// Drives the fast-track appraisal fee (AL-148, Figma 16 to 18b): Pay asks al-core for a payment
/// intent and opens Stripe's sheet; once the sheet completes, the app waits for the webhook to mark
/// the fee paid before showing the receipt, so a payment Stripe hasn't confirmed never looks paid.
@MainActor
@Observable
final class FeeViewModel {
    enum State: Equatable {
        case ready
        case starting
        /// Stripe's payment sheet is open with this intent (Figma 17).
        case sheet(FeeIntent)
        /// Waiting for the webhook (Figma 18b); after `confirmingSeconds` it says it's still waiting.
        case confirming(stillWaiting: Bool)
        case receipt(FeeReceipt)
        /// The underwriter decided before the fee was paid, so fast-track no longer applies.
        case decided
        /// Figma 16b.
        case failed(String)
    }

    static let couldNotStart = "We couldn't start the payment. Nothing was charged. Try again."
    static let decidedMessage = "Your application has already been decided, so fast-track no longer applies. Nothing was charged."
    /// Figma 18b: "After 20 seconds".
    static let confirmingSeconds: Double = 20

    private(set) var state: State = .ready
    /// Stripe's reason the last time its sheet failed. The borrower sees `couldNotStart`; this goes to the log.
    private(set) var lastSheetFailure: String?
    let applicationID: String
    let publishableKey: String?

    private let service: FeeService
    private var intent: FeeIntent?
    /// False once the application is decided without the fee paid (its status screen stops offering it).
    private var isOfferOpen = true
    /// Stripe's sheet completed, so the webhook will mark the fee paid whatever the application's status.
    private var paymentTaken = false
    private let logger = Logger(category: "Fee")

    init(applicationID: String, service: FeeService, publishableKey: String?) {
        self.applicationID = applicationID
        self.service = service
        let key = publishableKey?.trimmingCharacters(in: .whitespaces) ?? ""
        self.publishableKey = key.isEmpty ? nil : key
    }

    var isStarting: Bool { state == .starting }

    /// `currentFee` is the fee as the screen has it when Pay is tapped. If the webhook already marked it paid,
    /// al-core answers 409 and the fee won't change again, so it ends the wait straight away.
    func pay(currentFee: ApplicationFee? = nil) async {
        guard !isStarting else { return }
        guard publishableKey != nil else {
            logger.error("No AL_STRIPE_PUBLISHABLE_KEY (pk_test_…) in Config/Hosted.xcconfig, so the payment sheet can't open")
            state = .failed(Self.couldNotStart)
            return
        }
        state = .starting
        do {
            let intent = try await service.createIntent(applicationID: applicationID)
            self.intent = intent
            state = .sheet(intent)
        } catch APIError.conflict {
            // al-core already has a payment that went through (the app closed before the webhook, say):
            // wait for it rather than saying nothing was charged. A 409 for a decided application has no
            // webhook coming, so that one ends in `.decided` once the decision is known.
            logger.info("The fee intent was refused with 409, so wait for the webhook")
            state = isOfferOpen ? .confirming(stillWaiting: false) : .decided
            if let currentFee { feeChanged(currentFee) }
        } catch {
            logger.error("Creating the fee intent failed: \(String(describing: error), privacy: .public)")
            state = .failed(Self.couldNotStart)
        }
    }

    func sheetFinished(_ result: FeeSheetResult) {
        switch result {
        case .completed:
            paymentTaken = true
            state = .confirming(stillWaiting: false)
        case .canceled: state = .ready
        case .failed(let reason):
            lastSheetFailure = reason
            logger.error("Stripe's payment sheet failed: \(reason, privacy: .public)")
            state = .failed(Self.couldNotStart)
        }
    }

    /// The application's fee as Firestore has it now. Only the webhook's "paid" ends the wait.
    /// After a 409 there is no intent from this visit, so the receipt uses what the webhook recorded.
    func feeChanged(_ fee: ApplicationFee) {
        guard isWaitingForWebhook || state == .decided, fee.isPaid,
              let paymentIntentID = fee.paymentIntentID ?? intent?.paymentIntentID else { return }
        state = .receipt(FeeReceipt(amountEur: intent?.amountEur ?? ApplicationFee.amountEur, paidAt: fee.paidAt, paymentIntentID: paymentIntentID))
    }

    /// What the status screen offers now (`nil` once the application is decided without the fee paid).
    /// A decision ends the offer, and ends a wait that has no payment behind it from this visit.
    func offerChanged(_ section: ApplicationFee.Section?) {
        isOfferOpen = section != nil
        guard section == nil, !paymentTaken else { return }
        switch state {
        case .ready, .failed, .confirming: state = .decided
        case .starting, .sheet, .receipt, .decided: return
        }
    }

    private var isWaitingForWebhook: Bool {
        if case .confirming = state { return true }
        return false
    }

    func waitedTooLong() {
        guard case .confirming = state else { return }
        state = .confirming(stillWaiting: true)
    }
}
