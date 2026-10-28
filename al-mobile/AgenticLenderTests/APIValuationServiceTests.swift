import XCTest
@testable import AgenticLender

/// `POST /ai/valuation` through the gateway with the borrower's ID token (AL-143 criterion 3).
final class APIValuationServiceTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func service(token: String? = "id-token-123") -> APIValuationService {
        APIValuationService(baseURL: baseURL, session: StubURLProtocol.session, idToken: {
            guard let token else { throw APIError.signedOut }
            return token
        })
    }

    private func request() throws -> ValuationRequest {
        try XCTUnwrap(ValuationRequest(form: ValuationRequestTests.form()))
    }

    private func assertFails(with expected: APIError, file: StaticString = #filePath, line: UInt = #line) async throws {
        do {
            _ = try await service().value(request())
            XCTFail("expected \(expected)", file: file, line: line)
        } catch let error as APIError {
            XCTAssertEqual(error, expected, file: file, line: line)
        }
    }

    func testPostsTheFormToTheValuationEndpointWithTheIDToken() async throws {
        StubURLProtocol.response = (200, String(decoding: ValuationRequestTests.referenceResponse, as: UTF8.self))

        _ = try await service().value(request())

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/ai/valuation")
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer id-token-123")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(StubURLProtocol.lastBody)) as? [String: Any]
        XCTAssertEqual(body?["eircode"] as? String, "T12 X8Y2")
    }

    func testReturnsTheDecodedEstimate() async throws {
        StubURLProtocol.response = (200, String(decoding: ValuationRequestTests.referenceResponse, as: UTF8.self))

        let result = try await service().value(request())

        XCTAssertEqual(result.displayEstimateEur, 372_000)
    }

    func testNoSignedInUserFailsBeforeSending() async throws {
        do {
            _ = try await service(token: nil).value(request())
            XCTFail("expected signed out")
        } catch let error as APIError {
            XCTAssertEqual(error, .signedOut)
        }
        XCTAssertNil(StubURLProtocol.lastRequest)
    }

    func testAnExpiredTokenAsksTheBorrowerToSignInAgain() async throws {
        StubURLProtocol.response = (401, #"{"error": {"code": "UNAUTHENTICATED"}}"#)
        try await assertFails(with: .signedOut)
    }

    func testNoConnectionIsANetworkError() async throws {
        StubURLProtocol.failure = URLError(.cannotConnectToHost)
        try await assertFails(with: .network)
    }

    /// 503 is the model being unavailable; 422 would mean the form let something through.
    func testAServerErrorIsUnavailable() async throws {
        for status in [422, 500, 503] {
            StubURLProtocol.response = (status, #"{"error": {"code": "UNAVAILABLE"}}"#)
            try await assertFails(with: .unavailable)
        }
    }

    func testAnAnswerThatDoesNotMatchTheContractIsUnavailable() async throws {
        StubURLProtocol.response = (200, #"{"estimate": "about 370k"}"#)
        try await assertFails(with: .unavailable)
    }
}
