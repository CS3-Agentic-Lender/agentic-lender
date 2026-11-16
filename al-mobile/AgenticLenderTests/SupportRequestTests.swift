import XCTest
@testable import AgenticLender

/// Sending a support request (AL-149): the API call, and the form's sending, sent and couldn't-send states.
@MainActor
final class SupportRequestTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!
    private let created = ISO8601DateFormatter().date(from: "2026-11-19T15:10:00Z")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func api() -> APISupportService {
        APISupportService(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "test-token" })
    }

    private let createdJSON = #"""
    {"reference": "SR-P3AK5M72", "category": "application", "subject": "Can't see my valuation",
     "message": "Gone from my list.", "status": "open", "created_at": "2026-11-19T15:10:00Z"}
    """#

    private func form() -> SupportForm {
        SupportForm(category: .application, subject: "Can't see my valuation", message: "Gone from my list.", includeApplication: false)
    }

    // MARK: - POST /core/support-requests

    func testPostsTheRequestWithTheIDTokenAndReadsTheReference() async throws {
        StubURLProtocol.response = (201, createdJSON)

        let receipt = try await api().send(XCTUnwrap(form().body(applicationID: nil)))

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/support-requests")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(receipt, SupportReceipt(reference: "SR-P3AK5M72", sentAt: created))
    }

    func testAnAnswerWithoutAReferenceIsUnavailable() async throws {
        StubURLProtocol.response = (201, #"{"status": "open"}"#)

        do {
            _ = try await api().send(XCTUnwrap(form().body(applicationID: nil)))
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .unavailable)
        }
    }

    // MARK: - Criteria 2 and 3: sending, sent, and a failed send that keeps the text

    func testSendingShowsTheConfirmationWithTheReference() async {
        let service = FakeSupportService(result: .success(SupportReceipt(reference: "SR-P3AK5M72", sentAt: created)))
        let model = SupportFormViewModel(service: service, applicationID: nil)
        model.form = form()

        await model.send()

        XCTAssertEqual(model.state, .sent(SupportReceipt(reference: "SR-P3AK5M72", sentAt: created)))
        XCTAssertEqual(service.sentBodies.count, 1)
    }

    func testAFailedSendKeepsTheTextAndOffersTryAgain() async {
        let model = SupportFormViewModel(service: FakeSupportService(result: .failure(.network)), applicationID: nil)
        model.form = form()

        await model.send()

        XCTAssertEqual(model.state, .failed("We couldn't send your request. Check your connection and try again."))
        XCTAssertEqual(model.form, form(), "the borrower's text is kept")
    }

    func testAnInvalidFormShowsItsErrorsAndSendsNothing() async {
        let service = FakeSupportService(result: .failure(.network))
        let model = SupportFormViewModel(service: service, applicationID: nil)

        await model.send()

        XCTAssertTrue(model.showsErrors)
        XCTAssertEqual(model.state, .editing)
        XCTAssertTrue(service.sentBodies.isEmpty)
    }

    func testTheReplyPromiseIsTwoWorkingDays() {
        XCTAssertEqual(
            SupportFormViewModel.confirmation(for: SupportReceipt(reference: "SR-P3AK5M72", sentAt: created)),
            "Thanks, we've received your request SR-P3AK5M72 and will reply within 2 working days."
        )
    }
}

/// Answers every send with a fixed result and records the bodies.
@MainActor
final class FakeSupportService: SupportService {
    let result: Result<SupportReceipt, APIError>
    private(set) var sentBodies: [Data] = []

    init(result: Result<SupportReceipt, APIError>) {
        self.result = result
    }

    func send(_ body: Data) async throws -> SupportReceipt {
        sentBodies.append(body)
        return try result.get()
    }
}
