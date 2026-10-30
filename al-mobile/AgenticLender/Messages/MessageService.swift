import Foundation

/// Why the messages couldn't be read, or a message couldn't be sent or marked read.
enum MessageError: Error, Equatable {
    case network
    case signedOut
    case unavailable
}

/// Stops a live listener. Firestore's own registration in the app, a closure in tests.
///
/// It also stops when it's let go of, so a listener never outlives the inbox holding it: signing
/// out rebuilds the screens and lets go of Home's inbox without anyone calling `stop()`.
final class MessageListener {
    private var stopListening: (() -> Void)?

    init(_ stop: @escaping () -> Void) {
        stopListening = stop
    }

    /// Stops listening. Calling it again does nothing.
    func stop() {
        stopListening?()
        stopListening = nil
    }

    deinit {
        stop()
    }
}

/// Reads the borrower's message thread straight from Firestore, which the rules allow. Sending and
/// marking messages read go through al-core's message endpoints, the only writers (AL-147).
@MainActor
protocol MessageService: AnyObject {
    /// The signed-in borrower's uid, to tell their messages from their broker's.
    var myID: String? { get }
    /// The borrower's latest submitted application, whose thread they talk in. Nil before they submit:
    /// a broker can't see a Draft, so there's no one to talk to yet.
    func currentApplicationID() async throws -> String?
    /// Calls `onChange` with the whole thread now and after every change, until stopped.
    func listen(to applicationID: String, onChange: @escaping (Result<[Message], MessageError>) -> Void) -> MessageListener
    /// Sends a message on the application's thread and returns its id in Firestore.
    func send(_ text: String, on applicationID: String) async throws -> String
    /// Marks the replies the borrower has read: the messages the broker and underwriters sent.
    func markRead(on applicationID: String) async throws
}
