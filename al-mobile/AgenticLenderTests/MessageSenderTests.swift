import XCTest
@testable import AgenticLender

/// Showing who sent each reply, the broker or the bank's lending officer (AL-310).
final class MessageSenderTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!
    private let now = ISO8601DateFormatter().date(from: "2026-10-29T12:00:00Z")!

    private func message(_ id: String, from sender: String, as role: Message.Role, at time: String) -> Message {
        let sentAt = ISO8601DateFormatter().date(from: "2026-10-\(time):00Z")!
        return Message(id: id, senderID: sender, senderRole: role, text: "Message \(id)", sentAt: sentAt, read: true)
    }

    private func bubbles(_ messages: [Message]) -> [MessageThread.Bubble] {
        MessageThread(messages: messages, myID: "me", now: now, timeZone: utc).rows.compactMap { row in
            if case .bubble(let bubble) = row { return bubble }
            return nil
        }
    }

    /// Each bubble as "text: label", with the label the borrower sees above it, or "-" for none.
    private func labels(_ messages: [Message], brokerName: String? = "Bob Murphy") -> [String] {
        bubbles(messages).map { bubble in
            let label = bubble.showsSender ? bubble.sender.flatMap { ThreadParticipants.label(for: $0, brokerName: brokerName) } : nil
            return "\(bubble.text): \(label ?? "-")"
        }
    }

    // MARK: - Criterion 1: the lending officer is labelled

    func testAnUnderwritersMessageIsLabelledBankLendingOfficer() {
        let result = labels([message("1", from: "uw1", as: .underwriter, at: "29T09:40")])

        XCTAssertEqual(result, ["Message 1: Bank lending officer"])
    }

    // MARK: - Criterion 2: the broker is labelled by name

    func testABrokersMessageShowsTheBrokersName() {
        let result = labels([message("1", from: "bob", as: .broker, at: "29T09:40")])

        XCTAssertEqual(result, ["Message 1: Bob Murphy"])
    }

    func testABrokersMessageSaysBrokerWhenTheNameIsntKnown() {
        let result = labels([message("1", from: "bob", as: .broker, at: "29T09:40")], brokerName: nil)

        XCTAssertEqual(result, ["Message 1: Broker"])
    }

    func testTheBorrowersOwnMessagesHaveNoLabel() {
        let result = labels([message("1", from: "me", as: .borrower, at: "29T09:40")])

        XCTAssertEqual(result, ["Message 1: -"])
    }

    // MARK: - Criterion 3: one label per run from the same sender

    func testMessagesInARowFromOneSenderShowTheLabelOnceAboveTheFirst() {
        let result = labels([
            message("1", from: "bob", as: .broker, at: "29T09:00"),
            message("2", from: "bob", as: .broker, at: "29T09:30"),
            message("3", from: "uw1", as: .underwriter, at: "29T09:40"),
            message("4", from: "uw1", as: .underwriter, at: "29T09:41"),
            message("5", from: "me", as: .borrower, at: "29T09:50"),
            message("6", from: "uw1", as: .underwriter, at: "29T09:55"),
        ])

        XCTAssertEqual(result, [
            "Message 1: Bob Murphy",
            "Message 2: -",
            "Message 3: Bank lending officer",
            "Message 4: -",
            "Message 5: -",
            "Message 6: Bank lending officer",
        ])
    }

    func testTheLabelShowsAgainAfterANewDay() {
        let result = labels([
            message("1", from: "bob", as: .broker, at: "28T16:00"),
            message("2", from: "bob", as: .broker, at: "29T09:00"),
        ])

        XCTAssertEqual(result, ["Message 1: Bob Murphy", "Message 2: Bob Murphy"])
    }

    // MARK: - Criterion 4: an unknown role still shows, with no label

    func testAMessageWithAnUnknownRoleShowsWithNoLabel() {
        let result = labels([message("1", from: "x", as: .other, at: "29T09:40")])

        XCTAssertEqual(result, ["Message 1: -"])
    }

    // MARK: - Criterion 5: Home and the header say when the lending officer has written

    func testTheThreadKnowsWhenTheLendingOfficerHasWritten() {
        let brokerOnly = [message("1", from: "bob", as: .broker, at: "29T09:00")]
        let withOfficer = brokerOnly + [message("2", from: "uw1", as: .underwriter, at: "29T09:10")]

        XCTAssertFalse(MessageThread(messages: brokerOnly, myID: "me", now: now, timeZone: utc).lendingOfficerHasWritten)
        XCTAssertTrue(MessageThread(messages: withOfficer, myID: "me", now: now, timeZone: utc).lendingOfficerHasWritten)
    }

    func testTheHomeCardNamesOnlyTheBrokerUntilTheLendingOfficerWrites() {
        XCTAssertEqual(
            ThreadParticipants.homeDetail(brokerName: "Bob Murphy", lendingOfficerHasWritten: false),
            "Talk to Bob Murphy about your application."
        )
        XCTAssertEqual(
            ThreadParticipants.homeDetail(brokerName: "Bob Murphy", lendingOfficerHasWritten: true),
            "Talk to Bob Murphy and the bank's lending officer about your application."
        )
        XCTAssertEqual(
            ThreadParticipants.homeDetail(brokerName: nil, lendingOfficerHasWritten: true),
            "Talk to your broker and the bank's lending officer about your application."
        )
        XCTAssertNil(ThreadParticipants.homeDetail(brokerName: nil, lendingOfficerHasWritten: false))
    }

    func testTheHeaderSaysTheLendingOfficerIsInTheThreadOnceTheyHaveWritten() {
        XCTAssertEqual(
            ThreadParticipants.headerSubtitle(brokerFirm: "Murphy Mortgages", lendingOfficerHasWritten: false),
            "Your broker · Murphy Mortgages"
        )
        XCTAssertEqual(
            ThreadParticipants.headerSubtitle(brokerFirm: "Murphy Mortgages", lendingOfficerHasWritten: true),
            "Your broker · Murphy Mortgages, with the bank's lending officer"
        )
        XCTAssertEqual(ThreadParticipants.headerSubtitle(brokerFirm: nil, lendingOfficerHasWritten: false), "Your broker")
    }

    func testVoiceOverNamesTheSenderOfEveryReply() {
        let result = bubbles([
            message("1", from: "uw1", as: .underwriter, at: "29T09:40"),
            message("2", from: "uw1", as: .underwriter, at: "29T09:41"),
        ]).map { ThreadParticipants.spokenSender(of: $0, brokerName: "Bob Murphy") }

        XCTAssertEqual(result, ["Bank lending officer", "Bank lending officer"])
    }
}
