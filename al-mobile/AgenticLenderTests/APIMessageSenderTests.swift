import XCTest
@testable import AgenticLender

/// al-core's message endpoints as built on the messages backend ticket: `POST .../messages` answers
/// 201 with the saved message, `POST .../messages/read` answers 200 with how many it marked.
final class APIMessageSenderTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func sender(token: String? = "test-token") -> APIMessageSender {
        APIMessageSender(baseURL: baseURL, session: StubURLProtocol.session, idToken: {
            guard let token else { throw MessageError.signedOut }
            return token
        })
    }

    private let savedMessage = #"""
    {"id": "msg9", "application_id": "app1", "sender_id": "me", "sender_role": "borrower",
     "text": "Do you need my P60?", "sent_at": "2026-10-30T15:00:00Z", "read": false}
    """#

    // MARK: - Sending (criterion 2)

    func testSendsTheTextToTheApplicationsThreadWithTheIDToken() async throws {
        StubURLProtocol.response = (201, savedMessage)

        _ = try await sender().send("Do you need my P60?", on: "app1")

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/applications/app1/messages")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(StubURLProtocol.lastBody)) as? [String: Any]
        XCTAssertEqual(body as? [String: String], ["text": "Do you need my P60?"])
    }

    func testASavedMessageGivesBackItsID() async throws {
        StubURLProtocol.response = (201, savedMessage)

        let id = try await sender().send("Do you need my P60?", on: "app1")

        XCTAssertEqual(id, "msg9")
    }

    func testFailuresAreToldApart() async {
        for (status, expected) in [(401, MessageError.signedOut), (404, .unavailable), (409, .unavailable), (422, .unavailable), (500, .unavailable)] {
            StubURLProtocol.response = (status, #"{"error": {"code": "x", "message": "No"}}"#)
            await assertSendFails(with: expected, "\(status)")
        }
    }

    func testNoConnectionIsANetworkError() async {
        StubURLProtocol.failure = URLError(.notConnectedToInternet)
        await assertSendFails(with: .network)
    }

    func testAnAnswerTheAppCantReadIsUnavailable() async {
        StubURLProtocol.response = (201, #"{"unexpected": true}"#)
        await assertSendFails(with: .unavailable)
    }

    func testNoSignedInUserSendsNothing() async {
        do {
            _ = try await sender(token: nil).send("Hi", on: "app1")
            XCTFail("expected signedOut")
        } catch {
            XCTAssertEqual(error as? MessageError, .signedOut)
        }
        XCTAssertNil(StubURLProtocol.lastRequest)
    }

    // MARK: - Marking read (criterion 3)

    func testMarkingReadPostsToTheThreadsReadEndpointWithNoBody() async throws {
        StubURLProtocol.response = (200, #"{"marked": 2}"#)

        try await sender().markRead(on: "app1")

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/applications/app1/messages/read")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertNil(StubURLProtocol.lastBody)
    }

    func testMarkingReadThatFailsSaysWhy() async {
        StubURLProtocol.response = (401, "")
        do {
            try await sender().markRead(on: "app1")
            XCTFail("expected signedOut")
        } catch {
            XCTAssertEqual(error as? MessageError, .signedOut)
        }
    }

    private func assertSendFails(with expected: MessageError, _ note: String = "", line: UInt = #line) async {
        do {
            _ = try await sender().send("Hi", on: "app1")
            XCTFail("expected \(expected) \(note)", line: line)
        } catch {
            XCTAssertEqual(error as? MessageError, expected, note, line: line)
        }
    }
}
