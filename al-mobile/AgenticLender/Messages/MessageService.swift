import Foundation

/// Why the messages couldn't be read.
enum MessageError: Error, Equatable {
    case network
    case signedOut
    case unavailable
}

/// Stops a live listener. Firestore's own registration in the app, a closure in tests.
struct MessageListener {
    private let stopListening: () -> Void

    init(_ stop: @escaping () -> Void) {
        stopListening = stop
    }

    func stop() {
        stopListening()
    }
}

/// Reads the borrower's message thread straight from Firestore, which the rules allow. Sending and
/// marking messages read go through al-core's message endpoints once they exist.
@MainActor
protocol MessageService: AnyObject {
    /// The signed-in borrower's uid, to tell their messages from their broker's.
    var myID: String? { get }
    /// The borrower's latest submitted application, whose thread they talk in. Nil before they submit:
    /// a broker can't see a Draft, so there's no one to talk to yet.
    func currentApplicationID() async throws -> String?
    /// Calls `onChange` with the whole thread now and after every change, until stopped.
    func listen(to applicationID: String, onChange: @escaping (Result<[Message], MessageError>) -> Void) -> MessageListener
}
