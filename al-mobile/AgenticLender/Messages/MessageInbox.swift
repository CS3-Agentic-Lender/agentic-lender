import Foundation
import Observation
import os

/// The borrower's messages, live: Home shows the unread count and the thread screen shows the
/// messages, both from this one listener. Sending and marking read go through al-core (AL-147).
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

    /// al-core's limit on a message, counted the way it counts (Unicode scalars, as Python's `len`).
    static let maxLength = 2000

    private(set) var state: State = .loading
    /// The borrower's messages that aren't in the thread from Firestore yet, oldest first.
    private(set) var pending: [PendingMessage] = []

    private let service: MessageService
    private var listener: MessageListener?
    private var applicationID: String?
    private var isStarting = false
    /// Messages the borrower has seen in the thread. They count as read on this phone straight
    /// away, before al-core's mark-read reaches Firestore and the listener brings it back.
    private var seenIDs: Set<String> = []
    private let logger = Logger(category: "Messages")

    init(service: MessageService) {
        self.service = service
    }

    /// The thread laid out for the signed-in borrower, once messages have arrived.
    var thread: MessageThread? {
        guard case .ready(let messages) = state, let myID = service.myID else { return nil }
        let shown = messages.map { seenIDs.contains($0.id) ? $0.markedRead : $0 }
        return MessageThread(messages: shown, pending: pending, myID: myID)
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
            self.applicationID = applicationID
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

    /// Whether the composer's text can be sent: something besides spaces, within al-core's limit.
    static func canSend(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.unicodeScalars.count <= maxLength
    }

    /// Shows the message at the end of the thread straight away, then sends it. If it fails it stays
    /// there marked "Not sent" (Figma 15c) for the borrower to tap and try again.
    func send(_ text: String) async {
        guard Self.canSend(text), applicationID != nil, case .ready = state else { return }
        let message = PendingMessage(
            id: "local-\(UUID().uuidString)",
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            sentAt: .now,
            state: .sending
        )
        pending.append(message)
        await deliver(message.id)
    }

    /// Sends a "Not sent" message again, in the same place.
    func retry(_ id: String) async {
        guard let index = pending.firstIndex(where: { $0.id == id }), pending[index].state == .notSent else { return }
        pending[index].state = .sending
        await deliver(id)
    }

    /// Called when the borrower leaves the thread, so the Home badge and the "New messages" divider
    /// clear, and al-core marks the replies read for good. Replies that arrive afterwards are still
    /// new. If al-core can't be reached they stay read on this phone only; they're marked in Firestore
    /// the next time a reply arrives and the borrower leaves the thread, since al-core marks every unread reply.
    func markThreadRead() async {
        guard case .ready(let messages) = state else { return }
        let hadUnread = unreadCount > 0
        seenIDs = seenIDs.union(messages.map(\.id))
        guard hadUnread, let applicationID else { return }
        do {
            try await service.markRead(on: applicationID)
        } catch {
            logger.error("Marking the messages read failed: \(String(describing: error), privacy: .public)")
        }
    }

    func stop() {
        listener?.stop()
        listener = nil
    }

    private func deliver(_ id: String) async {
        guard let applicationID, let text = pending.first(where: { $0.id == id })?.text else { return }
        let outcome: PendingMessage.State
        do {
            outcome = .saved(serverID: try await service.send(text, on: applicationID))
        } catch {
            logger.error("Sending a message failed: \(String(describing: error), privacy: .public)")
            outcome = .notSent
        }
        guard let index = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[index].state = outcome
        dropDelivered()
    }

    /// Lets go of sent messages once the thread from Firestore has them, so each shows once.
    private func dropDelivered() {
        guard case .ready(let messages) = state else { return }
        let inThread = Set(messages.map(\.id))
        pending.removeAll { message in
            if case .saved(let serverID) = message.state { return inThread.contains(serverID) }
            return false
        }
    }

    private func received(_ result: Result<[Message], MessageError>) {
        switch result {
        case .success(let messages):
            state = .ready(messages)
            dropDelivered()
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
