import XCTest
@testable import AgenticLender

/// `POST /core/applications` as built by al-core: 201 for a new Draft, 200 with the borrower's
/// existing Draft unchanged, 409 when an application is already in progress.
final class APIApplicationServiceTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func service(token: String? = "test-token") -> APIApplicationService {
        APIApplicationService(baseURL: baseURL, session: StubURLProtocol.session, idToken: {
            guard let token else { throw ApplicationSaveError.signedOut }
            return token
        })
    }

    private func draft() throws -> ApplicationDraft {
        try XCTUnwrap(ApplicationDraft(form: TestFixtures.filledApplicationForm()))
    }

    private func applicationJSON(id: String = "app42") -> String {
        #"{"id": "\#(id)", "borrower_id": "u1", "broker_id": "broker1", "status": "Draft", "loan_type": "mortgage"}"#
    }

    func testPostsTheDraftToCoreApplicationsWithTheIDToken() async throws {
        StubURLProtocol.response = (201, applicationJSON())

        _ = try await service().saveDraft(draft())

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/applications")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(StubURLProtocol.lastBody)) as? [String: Any]
        XCTAssertEqual(body?["loan_type"] as? String, "mortgage")
        XCTAssertEqual(body?["loan_amount_eur"] as? Int, 210_000)
    }

    func testCreatedMeansANewDraftWasSaved() async throws {
        StubURLProtocol.response = (201, applicationJSON(id: "app42"))

        let outcome = try await service().saveDraft(draft())

        XCTAssertEqual(outcome, .created(id: "app42"))
    }

    func testOKMeansTheBorrowerAlreadyHadADraftAndItWasNotChanged() async throws {
        StubURLProtocol.response = (200, applicationJSON(id: "app7"))

        let outcome = try await service().saveDraft(draft())

        XCTAssertEqual(outcome, .existingDraft(id: "app7"))
    }

    func testConflictMeansAnApplicationIsAlreadyInProgress() async throws {
        StubURLProtocol.response = (409, #"{"error": {"code": "CONFLICT", "message": "You already have an application in progress (app3)"}}"#)

        await assertSaveFails(with: .inProgress)
    }

    func testConflictWithoutAProfileAsksForTheBorrowersDetails() async throws {
        StubURLProtocol.response = (409, conflict("Create your profile first with POST /core/me"))

        await assertSaveFails(with: .noProfile)
        XCTAssertEqual(ApplicationSaveError.noProfile.message, "Finish your details before you start an application.")
    }

    func testConflictWithoutABrokerAsksForOne() async throws {
        StubURLProtocol.response = (409, conflict("Choose a broker before starting an application"))

        await assertSaveFails(with: .noBroker)
        XCTAssertEqual(ApplicationSaveError.noBroker.message, "Choose a broker before you start an application.")
    }

    func testAnyOtherConflictShowsTheServersMessage() async throws {
        StubURLProtocol.response = (409, conflict("Applications are closed today"))

        await assertSaveFails(with: .rejected("Applications are closed today"))
        XCTAssertEqual(ApplicationSaveError.rejected("Applications are closed today").message, "Applications are closed today")
    }

    func testARejectedPropertyFieldIsNamedSoTheBorrowerKnowsWhatToFix() async throws {
        StubURLProtocol.response = (422, invalid(field: "property.eircode", message: "must be capitals with a space"))

        await assertSaveFails(with: .invalidField("Eircode"))
        XCTAssertEqual(
            ApplicationSaveError.invalidField("Eircode").message,
            "The Eircode wasn't accepted. Check it and save again."
        )
    }

    func testARejectedPropertyTypeIsNamed() async throws {
        StubURLProtocol.response = (422, invalid(field: "property.property_type", message: "not a supported type"))

        await assertSaveFails(with: .invalidField("property type"))
    }

    func testARejectedTopLevelFieldIsNamedToo() async throws {
        StubURLProtocol.response = (422, invalid(field: "loan_amount_eur", message: "must be greater than 0"))

        await assertSaveFails(with: .invalidField("loan amount"))
    }

    func testAnUnknownRejectedFieldFallsBackToTheServersMessage() async throws {
        StubURLProtocol.response = (422, invalid(field: "mystery", message: "mystery: not allowed"))

        await assertSaveFails(with: .rejected("mystery: not allowed"))
    }

    func testAnExpiredTokenAsksTheBorrowerToSignInAgain() async throws {
        StubURLProtocol.response = (401, "{}")

        await assertSaveFails(with: .signedOut)
    }

    func testNoSignedInUserFailsBeforeSending() async throws {
        do {
            _ = try await service(token: nil).saveDraft(draft())
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? ApplicationSaveError, .signedOut)
        }
        XCTAssertNil(StubURLProtocol.lastRequest)
    }

    func testOtherFailuresOrABadBodyAreUnavailable() async throws {
        for (status, body) in [(422, "{}"), (500, "{}"), (201, "not json")] {
            StubURLProtocol.reset()
            StubURLProtocol.response = (status, body)

            await assertSaveFails(with: .unavailable, "status \(status) with \(body)")
        }
    }

    func testNoConnectionIsANetworkError() async throws {
        StubURLProtocol.failure = URLError(.notConnectedToInternet)

        await assertSaveFails(with: .network)
    }

    /// al-core's error envelope for a 409 (docs/api-design.md section 8).
    private func conflict(_ message: String) -> String {
        #"{"error": {"code": "CONFLICT", "message": "\#(message)", "field": null, "request_id": "r1"}}"#
    }

    /// al-core's error envelope for a 422: the message starts with the field's path.
    private func invalid(field: String, message: String) -> String {
        #"{"error": {"code": "INVALID_FIELD", "message": "\#(message)", "field": "\#(field)", "request_id": "r1"}}"#
    }

    private func assertSaveFails(
        with expected: ApplicationSaveError,
        _ message: String = "",
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await service().saveDraft(draft())
            XCTFail("should throw \(expected) \(message)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ApplicationSaveError, expected, message, file: file, line: line)
        }
    }
}
