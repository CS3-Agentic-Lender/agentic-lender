import XCTest
@testable import AgenticLender

/// AL-239: saving a new borrower's profile tries once more after a dropped connection or a server
/// error, and removes the new login only when the profile really couldn't be saved.
final class ProfileSaveStepTests: XCTestCase {
    /// Answers each save with the next result in `results`, and counts saves, pauses and removals.
    private final class Recorder: @unchecked Sendable {
        var results: [Error?]
        private(set) var saves = 0
        private(set) var pauses = 0
        private(set) var removals = 0

        init(_ results: [Error?]) {
            self.results = results
        }

        func step() -> ProfileSaveStep {
            ProfileSaveStep(
                save: {
                    self.saves += 1
                    if let error = self.results.removeFirst() { throw error }
                },
                removeLogin: { self.removals += 1 },
                pause: { self.pauses += 1 }
            )
        }
    }

    private let serverError = CoreProfileAPI.ServerError(status: 503)

    func testASaveThatWorksFirstTimeNeitherRetriesNorRemovesTheLogin() async throws {
        let recorder = Recorder([nil])

        try await recorder.step().run()

        XCTAssertEqual(recorder.saves, 1)
        XCTAssertEqual(recorder.pauses, 0)
        XCTAssertEqual(recorder.removals, 0)
    }

    func testADroppedConnectionThenASuccessFinishesSignUp() async throws {
        let recorder = Recorder([AccountError.network, nil])

        try await recorder.step().run()

        XCTAssertEqual(recorder.saves, 2)
        XCTAssertEqual(recorder.pauses, 1, "waits about a second before the retry")
        XCTAssertEqual(recorder.removals, 0)
    }

    func testAServerErrorThenASuccessFinishesSignUp() async throws {
        let recorder = Recorder([serverError, nil])

        try await recorder.step().run()

        XCTAssertEqual(recorder.saves, 2)
        XCTAssertEqual(recorder.removals, 0)
    }

    func testARefusalRemovesTheLoginWithoutRetrying() async throws {
        let recorder = Recorder([AccountError.profileNotSaved])

        await assertFails(recorder, with: .profileNotSaved)

        XCTAssertEqual(recorder.saves, 1)
        XCTAssertEqual(recorder.pauses, 0)
        XCTAssertEqual(recorder.removals, 1)
    }

    func testTwoDroppedConnectionsRemoveTheLoginAndShowTheNetworkMessage() async throws {
        let recorder = Recorder([AccountError.network, AccountError.network])

        await assertFails(recorder, with: .network)

        XCTAssertEqual(recorder.saves, 2)
        XCTAssertEqual(recorder.removals, 1)
    }

    func testTwoServerErrorsRemoveTheLoginAndSayTheDetailsWerentSaved() async throws {
        let recorder = Recorder([serverError, serverError])

        await assertFails(recorder, with: .profileNotSaved)

        XCTAssertEqual(recorder.removals, 1)
        XCTAssertEqual(AccountError.profileNotSaved.message, "Your details couldn't be saved. Try again.")
    }

    func testRetriesAtMostOnce() async throws {
        let recorder = Recorder([serverError, AccountError.network, nil])

        await assertFails(recorder, with: .network)

        XCTAssertEqual(recorder.saves, 2)
    }

    func testARefusedRetryRemovesTheLoginWithTheRefusal() async throws {
        let recorder = Recorder([AccountError.network, AccountError.profileNotSaved])

        await assertFails(recorder, with: .profileNotSaved)

        XCTAssertEqual(recorder.removals, 1)
    }

    private func assertFails(
        _ recorder: Recorder,
        with expected: AccountError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            try await recorder.step().run()
            XCTFail("should throw \(expected)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? AccountError, expected, file: file, line: line)
        }
    }
}
