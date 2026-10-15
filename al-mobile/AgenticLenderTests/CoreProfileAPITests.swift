import XCTest
@testable import AgenticLender

/// `POST /core/me` as agreed with Dumi on AL-220: 201 the first time, 200 with the existing profile
/// on a repeat call, 422 naming a field when the input is refused.
final class CoreProfileAPITests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!

    /// Records the request it's given and answers with a fixed status, or fails with `failure`.
    private final class FakeNetwork: @unchecked Sendable {
        var status = 201
        var body = "{}"
        var failure: Error?
        private(set) var sent: URLRequest?

        func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
            sent = request
            if let failure { throw failure }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    private func profile() throws -> BorrowerProfile {
        try XCTUnwrap(BorrowerProfile(form: SignUpForm(
            fullName: "Alice Murphy",
            email: "alice@test.com",
            password: TestFixtures.password,
            phone: "087 123 4567",
            addressLine1: "12 Oak Park",
            addressLine2: "",
            county: .cork,
            eircode: "A65 F4E2"
        )))
    }

    private func api(_ network: FakeNetwork) -> CoreProfileAPI {
        CoreProfileAPI(baseURL: baseURL, send: { try await network.send($0) })
    }

    func testPostsTheProfileToCoreMeWithTheIDToken() async throws {
        let network = FakeNetwork()

        try await api(network).createProfile(profile(), idToken: "test-token")

        let sent = try XCTUnwrap(network.sent)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/me")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(sent.httpBody)) as? [String: Any]
        XCTAssertEqual(body?["full_name"] as? String, "Alice Murphy")
    }

    func testCreatedAndAlreadyExistingBothCountAsSaved() async throws {
        for status in [201, 200] {
            let network = FakeNetwork()
            network.status = status

            try await api(network).createProfile(profile(), idToken: "test-token")
        }
    }

    func testRefusedOrFailedRequestsMeanTheProfileWasNotSaved() async throws {
        for status in [401, 422, 500, 502] {
            let network = FakeNetwork()
            network.status = status

            do {
                try await api(network).createProfile(profile(), idToken: "test-token")
                XCTFail("status \(status) should throw")
            } catch {
                XCTAssertEqual(error as? AccountError, .profileNotSaved, "status \(status)")
            }
        }
    }

    func testNoConnectionIsANetworkError() async throws {
        let network = FakeNetwork()
        network.failure = URLError(.notConnectedToInternet)

        do {
            try await api(network).createProfile(profile(), idToken: "test-token")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? AccountError, .network)
        }
    }

    // MARK: - GET /core/me

    func testHasProfileAsksCoreMeWithTheIDToken() async throws {
        let network = FakeNetwork()
        network.status = 200

        let hasProfile = try await api(network).hasProfile(idToken: "test-token")

        XCTAssertTrue(hasProfile)
        let sent = try XCTUnwrap(network.sent)
        XCTAssertEqual(sent.httpMethod, "GET")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/me")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
    }

    func testNotFoundMeansNoProfileYet() async throws {
        let network = FakeNetwork()
        network.status = 404

        let hasProfile = try await api(network).hasProfile(idToken: "test-token")

        XCTAssertFalse(hasProfile)
    }

    func testOtherStatusesWhenCheckingAreAnError() async throws {
        for status in [401, 500, 502] {
            let network = FakeNetwork()
            network.status = status

            do {
                _ = try await api(network).hasProfile(idToken: "test-token")
                XCTFail("status \(status) should throw")
            } catch {
                XCTAssertEqual(error as? AccountError, .unknown, "status \(status)")
            }
        }
    }

    func testNoConnectionWhenCheckingIsANetworkError() async throws {
        let network = FakeNetwork()
        network.failure = URLError(.cannotConnectToHost)

        do {
            _ = try await api(network).hasProfile(idToken: "test-token")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? AccountError, .network)
        }
    }

    func testProfileReadsTheNameAndBrokerFromCoreMe() async throws {
        let network = FakeNetwork()
        network.status = 200
        network.body = #"""
        {"uid": "u1", "role": "borrower", "full_name": "Alice Byrne", "email": "alice@test.com",
         "broker_id": "broker1", "broker_name": "Bob Murphy", "broker_firm": "Murphy Mortgages"}
        """#

        let profile = try await api(network).profile(idToken: "test-token")

        XCTAssertEqual(profile, .aliceWithBob)
        let sent = try XCTUnwrap(network.sent)
        XCTAssertEqual(sent.httpMethod, "GET")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/me")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
    }

    func testAProfileWithoutABrokerHasNoBrokerName() async throws {
        let network = FakeNetwork()
        network.status = 200
        network.body = #"{"full_name": "Alice Byrne", "broker_id": null, "broker_name": null, "broker_firm": null}"#

        let profile = try await api(network).profile(idToken: "test-token")

        XCTAssertEqual(profile, .alice)
    }

    func testProfileFailsWithoutAProfileOrOnABadAnswer() async throws {
        for (status, body) in [(404, "{}"), (500, "{}"), (200, "not json"), (200, #"{"uid": "u1"}"#)] {
            let network = FakeNetwork()
            network.status = status
            network.body = body

            do {
                _ = try await api(network).profile(idToken: "test-token")
                XCTFail("status \(status) with \(body) should throw")
            } catch {
                XCTAssertEqual(error as? AccountError, .unknown, "status \(status) with \(body)")
            }
        }
    }

    func testNoConnectionWhenReadingTheProfileIsANetworkError() async throws {
        let network = FakeNetwork()
        network.failure = URLError(.notConnectedToInternet)

        do {
            _ = try await api(network).profile(idToken: "test-token")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? AccountError, .network)
        }
    }

    // MARK: - GET /core/brokers

    func testBrokersReadsTheListFromCoreBrokers() async throws {
        let network = FakeNetwork()
        network.status = 200
        network.body = #"""
        [{"uid": "broker1", "name": "Bob Murphy", "firm": "Murphy Mortgages"},
         {"uid": "broker2", "name": "Ciara Kelly", "firm": "Kelly Financial"}]
        """#

        let brokers = try await api(network).brokers(idToken: "test-token")

        XCTAssertEqual(brokers, [.bob, .ciara])
        let sent = try XCTUnwrap(network.sent)
        XCTAssertEqual(sent.httpMethod, "GET")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/brokers")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
    }

    func testBrokersFailsOnARefusalOrABadAnswer() async throws {
        for (status, body) in [(401, "[]"), (500, "[]"), (200, "not json")] {
            let network = FakeNetwork()
            network.status = status
            network.body = body

            do {
                _ = try await api(network).brokers(idToken: "test-token")
                XCTFail("status \(status) with \(body) should throw")
            } catch {
                XCTAssertEqual(error as? AccountError, .unknown, "status \(status) with \(body)")
            }
        }
    }

    func testNoConnectionWhenListingBrokersIsANetworkError() async throws {
        let network = FakeNetwork()
        network.failure = URLError(.timedOut)

        do {
            _ = try await api(network).brokers(idToken: "test-token")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? AccountError, .network)
        }
    }

    // MARK: - PUT /core/me/broker

    func testChooseBrokerPutsTheIDAndReadsBackTheProfile() async throws {
        let network = FakeNetwork()
        network.status = 200
        network.body = #"""
        {"full_name": "Alice Byrne", "broker_id": "broker1", "broker_name": "Bob Murphy", "broker_firm": "Murphy Mortgages"}
        """#

        let profile = try await api(network).chooseBroker(id: "broker1", idToken: "test-token")

        XCTAssertEqual(profile, .aliceWithBob)
        let sent = try XCTUnwrap(network.sent)
        XCTAssertEqual(sent.httpMethod, "PUT")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/me/broker")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(sent.httpBody)) as? [String: String]
        XCTAssertEqual(body, ["broker_id": "broker1"])
    }

    func testChooseBrokerFailsWhenRefused() async throws {
        for status in [403, 404, 422, 500] {
            let network = FakeNetwork()
            network.status = status

            do {
                _ = try await api(network).chooseBroker(id: "broker1", idToken: "test-token")
                XCTFail("status \(status) should throw")
            } catch {
                XCTAssertEqual(error as? AccountError, .unknown, "status \(status)")
            }
        }
    }

    func testNoConnectionWhenChoosingIsANetworkError() async throws {
        let network = FakeNetwork()
        network.failure = URLError(.networkConnectionLost)

        do {
            _ = try await api(network).chooseBroker(id: "broker1", idToken: "test-token")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? AccountError, .network)
        }
    }
}
