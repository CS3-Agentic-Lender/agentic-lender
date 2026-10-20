import XCTest
@testable import AgenticLender

/// `POST /core/applications/{id}/submit` as built by al-core (AL-245, AL-251): 200 with the application
/// now Applied, 409 once it has moved past Applied, 422 naming the first field a submit still needs.
final class ApplicationSubmitServiceTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func service() -> APIApplicationService {
        APIApplicationService(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "test-token" })
    }

    private func applied(id: String = "7f3k9qx2ab") -> String {
        #"{"id": "\#(id)", "borrower_id": "u1", "broker_id": "broker1", "status": "Applied", "loan_type": "mortgage"}"#
    }

    func testPostsToTheDraftsSubmitPathWithTheIDTokenAndNoBody() async throws {
        StubURLProtocol.response = (200, applied())

        _ = try await service().submit(id: "7f3k9qx2ab")

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/applications/7f3k9qx2ab/submit")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertNil(StubURLProtocol.lastBody)
    }

    func testASubmittedApplicationComesBackApplied() async throws {
        StubURLProtocol.response = (200, applied(id: "app42"))

        let submitted = try await service().submit(id: "app42")

        XCTAssertEqual(submitted.id, "app42")
        XCTAssertEqual(submitted.status, "Applied")
    }

    func testAMissingFieldIsNamedSoTheBorrowerKnowsWhatToAdd() async throws {
        StubURLProtocol.response = (422, missing("property.ber_rating"))

        await assertSubmitFails(with: .missingToSubmit("BER rating"))
        XCTAssertEqual(
            ApplicationSaveError.missingToSubmit("BER rating").message,
            "Add the BER rating before you submit."
        )
    }

    func testAnApplicationPastAppliedCantBeSubmittedAgain() async throws {
        let body = #"{"error": {"code": "CONFLICT", "message": "Only a Draft can be submitted; this application is Declined"}}"#
        StubURLProtocol.response = (409, body)

        await assertSubmitFails(with: .submitted)
    }

    func testADraftThatIsGoneSaysItIsNotFound() async throws {
        StubURLProtocol.response = (404, #"{"error": {"code": "NOT_FOUND", "message": "No application with that id"}}"#)

        await assertSubmitFails(with: .draftNotFound)
    }

    func testAnExpiredTokenAsksTheBorrowerToSignInAgain() async throws {
        StubURLProtocol.response = (401, #"{"error": {"code": "UNAUTHENTICATED", "message": "Token expired"}}"#)

        await assertSubmitFails(with: .signedOut)
    }

    /// al-core's 422 for a submit: the missing field's path, with "is required to submit".
    private func missing(_ field: String) -> String {
        #"{"error": {"code": "INVALID_FIELD", "message": "\#(field): is required to submit", "field": "\#(field)", "request_id": "r1"}}"#
    }

    private func assertSubmitFails(
        with expected: ApplicationSaveError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await service().submit(id: "app42")
            XCTFail("should throw \(expected)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ApplicationSaveError, expected, file: file, line: line)
        }
    }
}
