import XCTest
@testable import AgenticLender

/// Laying out the message thread (AL-147, Figma 15 and 15e) and reading messages from Firestore.
final class MessageThreadTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!
    private let now = ISO8601DateFormatter().date(from: "2026-10-29T12:00:00Z")!

    private func at(_ text: String) -> Date {
        ISO8601DateFormatter().date(from: "2026-10-\(text):00Z")!
    }

    private func message(_ id: String, from sender: String, _ text: String, at time: String, read: Bool = true) -> Message {
        Message(id: id, senderID: sender, senderRole: sender == "me" ? .borrower : .broker, text: text, sentAt: at(time), read: read)
    }

    private func thread(_ messages: [Message]) -> MessageThread {
        MessageThread(messages: messages, myID: "me", now: now, timeZone: utc)
    }

    private func describe(_ rows: [MessageThread.Row]) -> [String] {
        rows.map { row in
            switch row {
            case .day(let label): "day \(label)"
            case .newMessages: "new messages"
            case .bubble(let bubble): "\(bubble.isMine ? "me" : "them") \(bubble.text)\(bubble.time.map { " @\($0)" } ?? "")"
            }
        }
    }

    // MARK: - Criterion 1: the thread's messages in order

    func testMessagesAreInTheOrderTheyWereSentWithADayLabelForEachDay() {
        let rows = thread([
            message("3", from: "bob", "Quick question: is the €250 a month a car loan?", at: "29T09:40"),
            message("1", from: "bob", "Hi Alice, I've picked up your application.", at: "28T16:05"),
            message("2", from: "me", "Great, thanks Bob.", at: "28T16:12"),
            message("4", from: "me", "It's a car loan.", at: "29T09:52"),
        ]).rows

        XCTAssertEqual(describe(rows), [
            "day Yesterday",
            "them Hi Alice, I've picked up your application. @16:05",
            "me Great, thanks Bob. @16:12",
            "day Today",
            "them Quick question: is the €250 a month a car loan? @09:40",
            "me It's a car loan. @09:52",
        ])
    }

    func testOlderDaysAreLabelledWithTheDate() {
        let rows = thread([message("1", from: "bob", "Hello", at: "21T10:00")]).rows

        XCTAssertEqual(describe(rows).first, "day 21 Oct")
    }

    func testMessagesSentCloseTogetherShareOneTime() {
        let rows = thread([
            message("1", from: "bob", "Quick question", at: "29T09:40"),
            message("2", from: "bob", "No rush, whenever suits.", at: "29T09:41"),
            message("3", from: "bob", "Actually, one more thing", at: "29T09:50"),
        ]).rows

        XCTAssertEqual(describe(rows), [
            "day Today",
            "them Quick question",
            "them No rush, whenever suits. @09:41",
            "them Actually, one more thing @09:50",
        ])
    }

    func testTimesAreShownInTheBorrowersTimeZone() {
        let dublin = MessageThread(
            messages: [message("1", from: "bob", "Hi", at: "29T09:40")], myID: "me", now: now,
            timeZone: TimeZone(identifier: "Europe/Dublin")!
        )

        XCTAssertEqual(describe(dublin.rows).last, "them Hi @09:40", "Ireland is on GMT after the clocks change on 25 Oct")
    }

    // MARK: - Criterion 3: unread messages

    func testTheFirstUnreadReplyGetsANewMessagesDivider() {
        let rows = thread([
            message("1", from: "bob", "Hi Alice", at: "28T16:05"),
            message("2", from: "me", "Thanks", at: "28T16:12", read: false),
            message("3", from: "bob", "Quick question", at: "29T09:40", read: false),
            message("4", from: "bob", "No rush", at: "29T09:41", read: false),
        ]).rows

        XCTAssertEqual(describe(rows), [
            "day Yesterday",
            "them Hi Alice @16:05",
            "me Thanks @16:12",
            "day Today",
            "new messages",
            "them Quick question",
            "them No rush @09:41",
        ])
    }

    func testOnlyRepliesTheBorrowerHasntReadCountAsUnread() {
        let unread = thread([
            message("1", from: "bob", "Hi", at: "28T16:05"),
            message("2", from: "me", "Not read by Bob yet", at: "28T16:12", read: false),
            message("3", from: "bob", "Question", at: "29T09:40", read: false),
            message("4", from: "underwriter1", "From the bank", at: "29T09:45", read: false),
        ]).unreadCount

        XCTAssertEqual(unread, 2)
    }

    func testAThreadWithEverythingReadHasNoDivider() {
        let t = thread([message("1", from: "bob", "Hi", at: "29T09:40")])

        XCTAssertFalse(t.rows.contains(.newMessages))
        XCTAssertEqual(t.unreadCount, 0)
    }

    func testAnEmptyThreadHasNoRows() {
        XCTAssertEqual(thread([]).rows, [])
        XCTAssertTrue(thread([]).isEmpty)
    }

    // MARK: - Reading a message from Firestore (SCHEMA.md: applications/{id}/messages)

    func testReadsAMessagesFields() {
        let sent = at("29T09:40")

        let message = Message(id: "m1", fields: ["senderId": "bob", "senderRole": "broker", "text": "Hi", "sentAt": sent, "read": false])

        XCTAssertEqual(message, Message(id: "m1", senderID: "bob", senderRole: .broker, text: "Hi", sentAt: sent, read: false))
    }

    func testAMessageMissingItsTextSenderOrTimeIsSkipped() {
        let sent = at("29T09:40")
        XCTAssertNil(Message(id: "m", fields: ["senderId": "bob", "senderRole": "broker", "sentAt": sent]))
        XCTAssertNil(Message(id: "m", fields: ["senderRole": "broker", "text": "Hi", "sentAt": sent]))
        XCTAssertNil(Message(id: "m", fields: ["senderId": "bob", "senderRole": "broker", "text": "Hi"]))
    }

    func testAnUnknownRoleOrMissingReadFlagStillReads() {
        let message = Message(id: "m", fields: ["senderId": "x", "senderRole": "robot", "text": "Hi", "sentAt": at("29T09:40")])

        XCTAssertEqual(message?.senderRole, .other)
        XCTAssertEqual(message?.read, false)
    }
}
