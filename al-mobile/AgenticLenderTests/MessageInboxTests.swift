import XCTest
@testable import AgenticLender

/// A fake inbox: answers which application is the borrower's, and lets a test push message updates.
@MainActor
private final class FakeMessageService: MessageService {
    var myID: String? = "me"
    var application: Result<String?, MessageError> = .success("app1")
    private(set) var listenedTo: [String] = []
    private(set) var stopped = 0
    private var onChange: ((Result<[Message], MessageError>) -> Void)?

    func currentApplicationID() async throws -> String? {
        try application.get()
    }

    func listen(to applicationID: String, onChange: @escaping (Result<[Message], MessageError>) -> Void) -> MessageListener {
        listenedTo.append(applicationID)
        self.onChange = onChange
        return MessageListener { [weak self] in self?.stopped += 1 }
    }

    func push(_ result: Result<[Message], MessageError>) {
        onChange?(result)
    }
}

/// The borrower's messages, as the Home card and the thread screen share them (AL-147).
@MainActor
final class MessageInboxTests: XCTestCase {
    private let reply = Message(id: "m1", senderID: "bob", senderRole: .broker, text: "Hi", sentAt: .now, read: false)

    func testListensToTheBorrowersApplicationAndShowsNewMessagesAsTheyArrive() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)

        await inbox.start()
        XCTAssertEqual(service.listenedTo, ["app1"])
        XCTAssertEqual(inbox.state, .loading)

        service.push(.success([]))
        XCTAssertEqual(inbox.state, .ready([]))
        XCTAssertEqual(inbox.unreadCount, 0)

        service.push(.success([reply]))
        XCTAssertEqual(inbox.state, .ready([reply]))
        XCTAssertEqual(inbox.unreadCount, 1)
    }

    func testWithoutASubmittedApplicationThereIsNoThread() async {
        let service = FakeMessageService()
        service.application = .success(nil)
        let inbox = MessageInbox(service: service)

        await inbox.start()

        XCTAssertEqual(inbox.state, .noApplication)
        XCTAssertEqual(service.listenedTo, [])
        XCTAssertEqual(inbox.unreadCount, 0)
    }

    func testAFailureShowsAMessageAndRetryStartsAgain() async {
        let service = FakeMessageService()
        service.application = .failure(.network)
        let inbox = MessageInbox(service: service)

        await inbox.start()
        XCTAssertEqual(inbox.state, .failed(MessageInbox.message(for: .network)))

        service.application = .success("app1")
        await inbox.start()
        XCTAssertEqual(service.listenedTo, ["app1"])
    }

    func testALostListenerShowsAMessage() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)
        await inbox.start()

        service.push(.failure(.unavailable))

        XCTAssertEqual(inbox.state, .failed(MessageInbox.message(for: .unavailable)))
    }

    func testStartingTwiceKeepsOneListenerAndStopEndsIt() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)

        await inbox.start()
        await inbox.start()
        XCTAssertEqual(service.listenedTo, ["app1"])

        inbox.stop()
        XCTAssertEqual(service.stopped, 1)
    }

    func testTheThreadIsBuiltForTheSignedInBorrower() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)
        await inbox.start()
        let mine = Message(id: "m2", senderID: "me", senderRole: .borrower, text: "Thanks", sentAt: .now, read: false)

        service.push(.success([reply, mine]))

        XCTAssertEqual(inbox.thread?.unreadCount, 1, "my own unread message doesn't count")
    }

    func testEachFailureHasAPlainMessage() {
        XCTAssertEqual(MessageInbox.message(for: .network), "We couldn't load your messages. Check your connection and try again.")
        XCTAssertEqual(MessageInbox.message(for: .signedOut), "You've been signed out. Sign in again to see your messages.")
        XCTAssertEqual(MessageInbox.message(for: .unavailable), "We couldn't load your messages right now. Try again in a moment.")
    }
}
