import XCTest
@testable import AgenticLender

/// `POST /core/saved-checks` and `DELETE /core/saved-checks/{id}` as al-core built them: 201 with the id,
/// 409 at the 20-check limit, 204 for a delete and 404 when the check is already gone.
final class APISavedCheckClientTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func client(token: String? = "test-token") -> APISavedCheckClient {
        APISavedCheckClient(baseURL: baseURL, session: StubURLProtocol.session, idToken: {
            guard let token else { throw APIError.signedOut }
            return token
        })
    }

    private func draft() throws -> SavedCheckDraft {
        let request = try XCTUnwrap(ValuationRequest(form: PropertyCheckForm(
            county: .cork, eircode: "T12 X8Y2", floorArea: "110", bedrooms: 3,
            propertyType: .semiDetached, berRating: .b3, askingPrice: ""
        )))
        let result = ValuationResult(
            estimateEur: 345_000, displayEstimateEur: 345_000, basis: "2024 asking-price estimate",
            supportWarnings: [], askingPriceGap: nil, priceNeedsReview: nil, modelVersion: "v2",
            baselineEur: nil, contributions: nil
        )
        return SavedCheckDraft(request: request, result: result)
    }

    private func assertSaveFails(with expected: SavedCheckError, file: StaticString = #filePath, line: UInt = #line) async {
        do {
            _ = try await client().save(try draft())
            XCTFail("expected \(expected)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? SavedCheckError, expected, file: file, line: line)
        }
    }

    // MARK: - Saving

    func testPostsTheCheckWithTheIDTokenAndReturnsItsID() async throws {
        StubURLProtocol.response = (201, #"{"id": "c9", "property": {}, "estimated_value_eur": 345000}"#)

        let id = try await client().save(draft())

        XCTAssertEqual(id, "c9")
        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/saved-checks")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNotNil(StubURLProtocol.lastBody)
    }

    func testTheTwentyFirstCheckIsRefused() async {
        StubURLProtocol.response = (409, #"{"error": {"code": "CONFLICT", "message": "You can keep at most 20 saved property checks"}}"#)

        await assertSaveFails(with: .limitReached)
    }

    func testARefusedTokenMeansSignedOut() async {
        StubURLProtocol.response = (401, "")

        await assertSaveFails(with: .signedOut)
    }

    func testNoConnectionIsANetworkError() async {
        StubURLProtocol.failure = URLError(.notConnectedToInternet)

        await assertSaveFails(with: .network)
    }

    func testAnyOtherRefusalOrAnUnreadableAnswerIsUnavailable() async {
        for (status, body) in [(422, #"{"error": {"field": "property.eircode"}}"#), (500, ""), (201, "not json")] {
            StubURLProtocol.response = (status, body)
            await assertSaveFails(with: .unavailable)
        }
    }

    func testNoSignedInUserSendsNothing() async throws {
        do {
            _ = try await client(token: nil).save(draft())
            XCTFail("expected signedOut")
        } catch {
            XCTAssertEqual(error as? SavedCheckError, .signedOut)
        }
        XCTAssertNil(StubURLProtocol.lastRequest)
    }

    // MARK: - Deleting

    func testDeletesTheCheckByID() async throws {
        StubURLProtocol.response = (204, "")

        try await client().delete(id: "c9")

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "DELETE")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/saved-checks/c9")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
    }

    func testDeletingACheckThatIsAlreadyGoneIsFine() async throws {
        // 404: deleted on another device, so the list's next update drops it anyway.
        StubURLProtocol.response = (404, "")

        try await client().delete(id: "c9")
    }

    func testADeleteThatFailsSaysWhy() async {
        for (status, expected) in [(401, SavedCheckError.signedOut), (500, .unavailable)] {
            StubURLProtocol.response = (status, "")
            do {
                try await client().delete(id: "c9")
                XCTFail("expected \(expected)")
            } catch {
                XCTAssertEqual(error as? SavedCheckError, expected)
            }
        }
    }
}
