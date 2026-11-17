import Observation
import os

/// Drives the support form (AL-149, Figma 20 to 21a): field errors once the borrower tries to send,
/// "Sending…", the confirmation with the reference, or a failure that keeps their text for Try again.
@MainActor
@Observable
final class SupportFormViewModel {
    enum State: Equatable {
        case editing
        case sending
        case sent(SupportReceipt)
        /// The send failed; the form keeps its text and offers Try again (Figma 21a).
        case failed(String)
    }

    static let failedMessage = "We couldn't send your request. Check your connection and try again."

    var form = SupportForm()
    private(set) var state: State = .editing
    /// Errors show only after the first Send, so an empty form doesn't open in red (Figma 20 vs 20a).
    private(set) var showsErrors = false
    /// The borrower's application, for "Include my application reference". Nil without one.
    let applicationID: String?

    private let service: SupportService
    private let logger = Logger(category: "Support")

    init(service: SupportService, applicationID: String?) {
        self.service = service
        self.applicationID = applicationID
    }

    /// The reference as Figma shows it beside the toggle, such as "2026-0042".
    var applicationReference: String? {
        applicationID.map { ApplicationReference(applicationID: $0).text }
    }

    var isSending: Bool { state == .sending }

    func send() async {
        guard !isSending else { return }
        showsErrors = true
        guard let body = form.body(applicationID: applicationID) else { return }
        state = .sending
        do {
            state = .sent(try await service.send(body))
        } catch {
            logger.error("Sending the support request failed: \(String(describing: error), privacy: .public)")
            state = .failed(Self.failedMessage)
        }
    }

    /// "Thanks, we've received your request SR-P3AK5M72 and will reply within 2 working days."
    static func confirmation(for receipt: SupportReceipt) -> String {
        "Thanks, we've received your request \(receipt.reference) and will reply within 2 working days."
    }
}
