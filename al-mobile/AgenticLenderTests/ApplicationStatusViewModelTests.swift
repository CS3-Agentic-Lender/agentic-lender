import XCTest
@testable import AgenticLender

private actor FakeStatusService: ApplicationStatusService {
    private var answers: [Result<ApplicationStatusRecord, ApplicationStatusError>]
    private(set) var requested: [String] = []

    init(_ answers: Result<ApplicationStatusRecord, ApplicationStatusError>...) {
        self.answers = answers
    }

    func status(of applicationID: String) async throws -> ApplicationStatusRecord {
        requested.append(applicationID)
        return try answers.removeFirst().get()
    }
}

/// Loading the "My application" screen (AL-102).
@MainActor
final class ApplicationStatusViewModelTests: XCTestCase {
    private let applied = ApplicationStatusRecord(status: .applied, createdAt: nil, submittedAt: nil, decision: nil, history: [])

    func testLoadsTheApplicationsTimeline() async {
        let service = FakeStatusService(.success(applied))
        let model = ApplicationStatusViewModel(applicationID: "app-7f3k9qx2", service: service)

        await model.load()

        XCTAssertEqual(model.timeline, StatusTimeline(record: applied))
        XCTAssertNil(model.loadError)
        XCTAssertEqual(model.reference, "Ref APP-7F3K")
        let requested = await service.requested
        XCTAssertEqual(requested, ["app-7f3k9qx2"])
    }

    func testIsLoadingUntilTheAnswerComes() {
        let model = ApplicationStatusViewModel(applicationID: "a1", service: FakeStatusService(.success(applied)))

        XCTAssertTrue(model.isLoading)
        XCTAssertNil(model.timeline)
    }

    func testEachFailureHasAPlainMessage() {
        XCTAssertEqual(ApplicationStatusViewModel.message(for: .network), "We couldn't load your application. Check your connection and try again.")
        XCTAssertEqual(ApplicationStatusViewModel.message(for: .notFound), "We couldn't find this application. It may have been removed.")
        XCTAssertEqual(ApplicationStatusViewModel.message(for: .unavailable), "We couldn't load your application right now. Try again in a moment.")
    }

    func testAFailedLoadShowsItsMessageAndRetryLoadsAgain() async {
        let service = FakeStatusService(.failure(.network), .success(applied))
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service)

        await model.load()
        XCTAssertEqual(model.loadError, ApplicationStatusViewModel.message(for: .network))
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.timeline)

        await model.load()
        XCTAssertNil(model.loadError)
        XCTAssertNotNil(model.timeline)
    }
}
