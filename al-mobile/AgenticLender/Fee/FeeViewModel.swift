import Foundation
import Observation
import os

/// What the payment sheet reported when it closed. Stripe shows a declined card inside the sheet
/// itself (Figma 17b), so a decline isn't a result here: the borrower tries another card there.
enum FeeSheetResult: Equatable {
    case completed
    case canceled
    case failed
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
        /// Figma 16b.
        case failed(String)
    }

    static let couldNotStart = "We couldn't start the payment. Nothing was charged. Try again."
    /// Figma 18b: "After 20 seconds".
    static let confirmingSeconds: Double = 20

    private(set) var state: State = .ready
    let applicationID: String
    let publishableKey: String?

    private let service: FeeService
    private var intent: FeeIntent?
    private let logger = Logger(category: "Fee")

    init(applicationID: String, service: FeeService, publishableKey: String?) {
        self.applicationID = applicationID
        self.service = service
        let key = publishableKey?.trimmingCharacters(in: .whitespaces) ?? ""
        self.publishableKey = key.isEmpty ? nil : key
    }

    var isStarting: Bool { state == .starting }

    func pay() async {
        guard !isStarting else { return }
        guard publishableKey != nil else {
            logger.error("No STRIPE_PUBLISHABLE_KEY is set, so the payment sheet can't open")
            state = .failed(Self.couldNotStart)
            return
        }
        state = .starting
        do {
            let intent = try await service.createIntent(applicationID: applicationID)
            self.intent = intent
            state = .sheet(intent)
        } catch {
            logger.error("Creating the fee intent failed: \(String(describing: error), privacy: .public)")
            state = .failed(Self.couldNotStart)
        }
    }

    func sheetFinished(_ result: FeeSheetResult) {
        switch result {
        case .completed: state = .confirming(stillWaiting: false)
        case .canceled: state = .ready
        case .failed: state = .failed(Self.couldNotStart)
        }
    }

    /// The application's fee as Firestore has it now. Only the webhook's "paid" ends the wait.
    func feeChanged(_ fee: ApplicationFee) {
        guard case .confirming = state, fee.isPaid, let intent else { return }
        state = .receipt(FeeReceipt(amountEur: intent.amountEur, paidAt: fee.paidAt, paymentIntentID: fee.paymentIntentID ?? intent.paymentIntentID))
    }

    func waitedTooLong() {
        guard case .confirming = state else { return }
        state = .confirming(stillWaiting: true)
    }
}
