import XCTest
@testable import AgenticLender

/// Answers every request made through its session with a canned response, and records the request.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var response: (status: Int, body: String)?
    nonisolated(unsafe) static var failure: URLError?
    nonisolated(unsafe) static var lastRequest: URLRequest?
    nonisolated(unsafe) static var lastBody: Data?

    static func reset() {
        response = nil
        failure = nil
        lastRequest = nil
        lastBody = nil
    }

    static var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        Self.lastBody = request.httpBody ?? request.httpBodyStream.map(Self.read)
        if let failure = Self.failure {
            client?.urlProtocol(self, didFailWithError: failure)
            return
        }
        let (status, body) = Self.response ?? (200, "")
        let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class APIAffordabilityServiceTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func service(token: String? = "test-token") -> APIAffordabilityService {
        APIAffordabilityService(baseURL: baseURL, session: StubURLProtocol.session, idToken: {
            guard let token else { throw AffordabilityError.signedOut }
            return token
        })
    }

    private func request() throws -> AffordabilityRequest {
        try XCTUnwrap(AffordabilityRequest(form: TestFixtures.affordabilityForm(income: "60,000", deposit: "40,000")))
    }

    func testPostsTheRequestToTheAffordabilityEndpointWithTheIDToken() async throws {
        StubURLProtocol.response = (200, TestFixtures.affordabilityJSON())

        _ = try await service().calculate(request())

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/ai/affordability")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(StubURLProtocol.lastBody)) as? [String: Any]
        XCTAssertEqual(body?["gross_income_eur"] as? Int, 60_000)
    }

    func testReturnsTheDecodedResult() async throws {
        StubURLProtocol.response = (200, TestFixtures.affordabilityJSON(limitedBy: "deposit"))

        let result = try await service().calculate(request())

        XCTAssertEqual(result.maxLoanEur, 240_000)
        XCTAssertEqual(result.limitedBy, .deposit)
    }

    func testNoSignedInUserFailsBeforeSending() async throws {
        await assertThrows(.signedOut) { try await self.service(token: nil).calculate(self.request()) }
        XCTAssertNil(StubURLProtocol.lastRequest)
    }

    func testAnExpiredTokenAsksTheBorrowerToSignInAgain() async {
        StubURLProtocol.response = (401, #"{"error": {"code": "UNAUTHENTICATED"}}"#)

        await assertThrows(.signedOut) { try await self.service().calculate(self.request()) }
    }

    func testNoConnectionIsANetworkError() async {
        StubURLProtocol.failure = URLError(.notConnectedToInternet)

        await assertThrows(.network) { try await self.service().calculate(self.request()) }
    }

    func testAServerErrorIsUnavailable() async {
        for status in [422, 500, 503] {
            StubURLProtocol.response = (status, #"{"error": {"code": "INTERNAL"}}"#)

            await assertThrows(.unavailable) { try await self.service().calculate(self.request()) }
        }
    }

    func testAResponseThatDoesNotMatchTheContractIsUnavailable() async {
        StubURLProtocol.response = (200, "Too many requests")

        await assertThrows(.unavailable) { try await self.service().calculate(self.request()) }
    }

    private func assertThrows(
        _ expected: AffordabilityError,
        _ call: @escaping () async throws -> AffordabilityResult,
        file: StaticString = #filePath, line: UInt = #line
    ) async {
        do {
            _ = try await call()
            XCTFail("Expected \(expected)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? AffordabilityError, expected, file: file, line: line)
        }
    }
}
