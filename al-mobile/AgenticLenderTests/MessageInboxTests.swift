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

    /// What each send answers, in order; the last one repeats. A server id, or an error.
    var sendResults: [Result<String, MessageError>] = [.success("srv1")]
    /// When set, a send waits here until the test opens it.
    var sendGate: CallGate?
    private(set) var sent: [(text: String, applicationID: String)] = []

    func send(_ text: String, on applicationID: String) async throws -> String {
        sent.append((text, applicationID))
        let result = sendResults.count > 1 ? sendResults.removeFirst() : sendResults[0]
        if let sendGate { await sendGate.pass() }
        return try result.get()
    }

    var markReadResult: Result<Void, MessageError> = .success(())
    private(set) var markedRead: [String] = []

    func markRead(on applicationID: String) async throws {
        markedRead.append(applicationID)
        try markReadResult.get()
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

    func testLettingGoOfTheInboxStopsItsListener() async {
        // Signing out rebuilds the screens, which lets go of Home's inbox without calling stop().
        let service = FakeMessageService()
        var inbox: MessageInbox? = MessageInbox(service: service)
        await inbox?.start()

        inbox = nil

        XCTAssertNil(inbox)
        XCTAssertEqual(service.stopped, 1)
    }

    func testStoppingThenLettingGoStopsTheListenerOnce() async {
        let service = FakeMessageService()
        var inbox: MessageInbox? = MessageInbox(service: service)
        await inbox?.start()

        inbox?.stop()
        inbox = nil

        XCTAssertEqual(service.stopped, 1)
    }

    // MARK: - Criterion 2: sending, and "Not sent. Tap to try again"

    private func started(_ service: FakeMessageService, with messages: [Message] = []) async -> MessageInbox {
        let inbox = MessageInbox(service: service)
        await inbox.start()
        service.push(.success(messages))
        return inbox
    }

    private func myBubbles(_ inbox: MessageInbox) -> [MessageThread.Bubble] {
        (inbox.thread?.rows ?? []).compactMap { row in
            if case .bubble(let bubble) = row, bubble.isMine { return bubble }
            return nil
        }
    }

    func testASentMessageShowsStraightAwayWhileItSends() async {
        let service = FakeMessageService()
        let gate = CallGate()
        service.sendGate = gate
        let inbox = await started(service, with: [reply])

        let sending = Task { await inbox.send("  Do you need my P60?  ") }
        await gate.waitForCall()

        XCTAssertEqual(service.sent.map(\.text), ["Do you need my P60?"], "trimmed")
        XCTAssertEqual(service.sent.map(\.applicationID), ["app1"])
        XCTAssertEqual(myBubbles(inbox).map(\.text), ["Do you need my P60?"])
        XCTAssertEqual(myBubbles(inbox).map(\.delivery), [.sending])
        gate.open()
        await sending.value
    }

    func testOnceFirestoreHasTheMessageItShowsOnce() async {
        let service = FakeMessageService()
        let inbox = await started(service, with: [reply])

        await inbox.send("Do you need my P60?")
        XCTAssertEqual(myBubbles(inbox).map(\.delivery), [.sending], "sent, but not in the thread yet")

        let saved = Message(id: "srv1", senderID: "me", senderRole: .borrower, text: "Do you need my P60?", sentAt: .now, read: false)
        service.push(.success([reply, saved]))

        XCTAssertEqual(myBubbles(inbox).map(\.text), ["Do you need my P60?"])
        XCTAssertEqual(myBubbles(inbox).map(\.delivery), [.sent])
    }

    func testAFailedSendIsMarkedNotSentAndTappingSendsItAgain() async throws {
        let service = FakeMessageService()
        service.sendResults = [.failure(.network), .success("srv2")]
        let inbox = await started(service)

        await inbox.send("Do you need my P60?")
        XCTAssertEqual(myBubbles(inbox).map(\.delivery), [.notSent])

        let failed = try XCTUnwrap(myBubbles(inbox).first)
        await inbox.retry(failed.id)

        XCTAssertEqual(service.sent.map(\.text), ["Do you need my P60?", "Do you need my P60?"])
        XCTAssertEqual(myBubbles(inbox).map(\.delivery), [.sending])
        XCTAssertEqual(myBubbles(inbox).count, 1, "the retry doesn't add a second bubble")
    }

    func testRetryingAMessageThatIsntFailedDoesNothing() async throws {
        let service = FakeMessageService()
        let inbox = await started(service)
        await inbox.send("Hi")
        let bubble = try XCTUnwrap(myBubbles(inbox).first)

        await inbox.retry(bubble.id)

        XCTAssertEqual(service.sent.count, 1)
    }

    func testBlankOrOverlongTextSendsNothing() async {
        let service = FakeMessageService()
        let inbox = await started(service)

        await inbox.send("   \n ")
        await inbox.send(String(repeating: "a", count: MessageInbox.maxLength + 1))

        XCTAssertTrue(service.sent.isEmpty)
        XCTAssertTrue(myBubbles(inbox).isEmpty)
        XCTAssertFalse(MessageInbox.canSend("   "))
        XCTAssertTrue(MessageInbox.canSend(String(repeating: "a", count: MessageInbox.maxLength)))
        XCTAssertFalse(MessageInbox.canSend(String(repeating: "a", count: MessageInbox.maxLength + 1)))
    }

    func testNothingSendsBeforeTheThreadIsOpen() async {
        let service = FakeMessageService()
        service.application = .success(nil)
        let inbox = MessageInbox(service: service)
        await inbox.start()

        await inbox.send("Hi")

        XCTAssertTrue(service.sent.isEmpty)
    }

    func testMyPendingMessagesDontCountAsUnread() async {
        let service = FakeMessageService()
        service.sendResults = [.failure(.network)]
        let inbox = await started(service)

        await inbox.send("Hi")

        XCTAssertEqual(inbox.unreadCount, 0)
    }

    // MARK: - Criterion 3: the badge clears once the thread is opened

    func testLeavingTheThreadMarksTheRepliesReadInFirestore() async {
        let service = FakeMessageService()
        let inbox = await started(service, with: [reply])

        await inbox.markThreadRead()

        XCTAssertEqual(service.markedRead, ["app1"])
        XCTAssertEqual(inbox.unreadCount, 0)
    }

    func testWithNothingUnreadNothingIsMarked() async {
        let service = FakeMessageService()
        let inbox = await started(service, with: [reply.markedRead])

        await inbox.markThreadRead()

        XCTAssertTrue(service.markedRead.isEmpty)
    }

    func testIfMarkingReadFailsTheBadgeStillClearsOnThisPhone() async {
        let service = FakeMessageService()
        service.markReadResult = .failure(.network)
        let inbox = await started(service, with: [reply])

        await inbox.markThreadRead()

        XCTAssertEqual(inbox.unreadCount, 0, "the borrower has seen them; Firestore catches up next time")
    }

    // MARK: - Read on this phone straight away, before Firestore answers

    func testLeavingTheThreadClearsTheBadgeAndTheDivider() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)
        await inbox.start()
        service.push(.success([reply]))
        XCTAssertEqual(inbox.unreadCount, 1)
        XCTAssertTrue(inbox.thread?.rows.contains(.newMessages) ?? false)

        await inbox.markThreadRead()

        XCTAssertEqual(inbox.unreadCount, 0)
        XCTAssertFalse(inbox.thread?.rows.contains(.newMessages) ?? true)
    }

    func testAReplyThatArrivesAfterLeavingTheThreadIsStillNew() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)
        await inbox.start()
        service.push(.success([reply]))
        await inbox.markThreadRead()
        let later = Message(id: "m3", senderID: "bob", senderRole: .broker, text: "One more thing", sentAt: .now, read: false)

        service.push(.success([reply, later]))

        XCTAssertEqual(inbox.unreadCount, 1)
    }

    func testMarkingReadBeforeAnyMessagesHaveArrivedDoesNothing() async {
        let service = FakeMessageService()
        let inbox = MessageInbox(service: service)
        await inbox.start()

        await inbox.markThreadRead()
        service.push(.success([reply]))

        XCTAssertEqual(inbox.unreadCount, 1)
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
