import Observation
import os

/// The borrower's messages, live: Home shows the unread count and the thread screen shows the
/// messages, both from this one listener (AL-147).
@MainActor
@Observable
final class MessageInbox {
    enum State: Equatable {
        case loading
        /// Nothing submitted yet, so there's no thread.
        case noApplication
        case ready([Message])
        case failed(String)
    }

    private(set) var state: State = .loading

    private let service: MessageService
    private var listener: MessageListener?
    private var isStarting = false
    /// Messages the borrower has seen in the thread. They count as read on this phone only, until
    /// al-core's mark-read endpoint exists to set `read` in Firestore; a relaunch forgets them.
    private var seenIDs: Set<String> = []
    private let logger = Logger(category: "Messages")

    init(service: MessageService) {
        self.service = service
    }

    /// The thread laid out for the signed-in borrower, once messages have arrived.
    var thread: MessageThread? {
        guard case .ready(let messages) = state, let myID = service.myID else { return nil }
        let shown = messages.map { seenIDs.contains($0.id) ? $0.markedRead : $0 }
        return MessageThread(messages: shown, myID: myID)
    }

    var unreadCount: Int { thread?.unreadCount ?? 0 }

    /// Finds the borrower's application and starts listening to its thread. Does nothing while
    /// already listening, so Home and the thread screen can both call it.
    func start() async {
        guard listener == nil, !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        state = .loading
        do {
            guard let applicationID = try await service.currentApplicationID() else {
                state = .noApplication
                return
            }
            listener = service.listen(to: applicationID) { [weak self] result in
                self?.received(result)
            }
        } catch let error as MessageError {
            state = .failed(Self.message(for: error))
        } catch {
            logger.error("Unexpected error finding the application to message on: \(error.localizedDescription, privacy: .public)")
            state = .failed(Self.message(for: .unavailable))
        }
    }

    /// Called when the borrower leaves the thread, so the Home badge and the "New messages" divider
    /// clear. Replies that arrive afterwards are still new.
    func markThreadRead() {
        guard case .ready(let messages) = state else { return }
        seenIDs = seenIDs.union(messages.map(\.id))
    }

    func stop() {
        listener?.stop()
        listener = nil
    }

    private func received(_ result: Result<[Message], MessageError>) {
        switch result {
        case .success(let messages):
            state = .ready(messages)
        case .failure(let error):
            // Firestore ends a listener after an error, so a later start() must set up a new one.
            listener = nil
            state = .failed(Self.message(for: error))
        }
    }

    static func message(for error: MessageError) -> String {
        switch error {
        case .network: "We couldn't load your messages. Check your connection and try again."
        case .signedOut: "You've been signed out. Sign in again to see your messages."
        case .unavailable: "We couldn't load your messages right now. Try again in a moment."
        }
    }
}
