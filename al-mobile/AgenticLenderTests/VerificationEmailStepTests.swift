import XCTest
@testable import AgenticLender

/// AL-249: after sign-up the borrower is sent a link to verify their email, so a later Continue
/// with Google links to their account instead of replacing their password.
final class VerificationEmailStepTests: XCTestCase {
    private struct MailTrouble: Error {}

    /// Counts the verification emails requested and the failures logged.
    private final class Recorder: @unchecked Sendable {
        var failure: Error?
        private(set) var requests = 0
        private(set) var loggedFailures = 0

        func step() -> VerificationEmailStep {
            VerificationEmailStep(
                send: {
                    self.requests += 1
                    if let failure = self.failure { throw failure }
                },
                logFailure: { _ in self.loggedFailures += 1 }
            )
        }
    }

    func testRequestsTheVerificationEmailOnce() async {
        let recorder = Recorder()

        await recorder.step().run()

        XCTAssertEqual(recorder.requests, 1)
        XCTAssertEqual(recorder.loggedFailures, 0)
    }

    func testAFailedRequestIsLoggedAndDoesNotUndoTheSignUp() async {
        let recorder = Recorder()
        recorder.failure = MailTrouble()

        await recorder.step().run() // doesn't throw: the account and profile already exist

        XCTAssertEqual(recorder.requests, 1)
        XCTAssertEqual(recorder.loggedFailures, 1)
    }
}
