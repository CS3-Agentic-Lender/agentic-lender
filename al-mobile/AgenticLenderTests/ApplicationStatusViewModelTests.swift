import XCTest
@testable import AgenticLender

/// A fake live status: records what was listened to and lets a test push updates.
@MainActor
private final class FakeStatusService: ApplicationStatusService {
    private(set) var listenedTo: [String] = []
    private(set) var stopped = 0
    private var onChange: ((Result<StatusUpdate, ApplicationStatusError>) -> Void)?

    func listen(to applicationID: String, onChange: @escaping (Result<StatusUpdate, ApplicationStatusError>) -> Void) -> LiveListener {
        listenedTo.append(applicationID)
        self.onChange = onChange
        return LiveListener { [weak self] in self?.stopped += 1 }
    }

    func push(_ result: Result<StatusUpdate, ApplicationStatusError>) {
        onChange?(result)
    }
}

/// A fake network: lets a test say when the phone loses and gets back its connection.
@MainActor
private final class FakeNetwork: NetworkMonitor {
    private(set) var stopped = 0
    private var onChange: ((Bool) -> Void)?

    func watch(onChange: @escaping (Bool) -> Void) -> LiveListener {
        self.onChange = onChange
        return LiveListener { [weak self] in self?.stopped += 1 }
    }

    func set(connected: Bool) {
        onChange?(connected)
    }
}

/// The "My application" screen, live (AL-102, AL-103, Figma 14 to 14d).
@MainActor
final class ApplicationStatusViewModelTests: XCTestCase {
    private let applied = ApplicationStatusRecord(status: .applied, createdAt: nil, submittedAt: nil, decision: nil, history: [])
    private let deliberated = ApplicationStatusRecord(status: .aiDeliberated, createdAt: nil, submittedAt: nil, decision: nil, history: [])
    private let network = FakeNetwork()

    private func fresh(_ record: ApplicationStatusRecord) -> Result<StatusUpdate, ApplicationStatusError> {
        .success(StatusUpdate(record: record, isFromCache: false))
    }

    private func cached(_ record: ApplicationStatusRecord) -> Result<StatusUpdate, ApplicationStatusError> {
        .success(StatusUpdate(record: record, isFromCache: true))
    }

    func testListensToTheApplicationAndShowsItsTimeline() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "app-7f3k9qx2", service: service, network: network)

        model.start()
        XCTAssertTrue(model.isLoading)
        XCTAssertNil(model.timeline)

        service.push(fresh(applied))

        XCTAssertEqual(service.listenedTo, ["app-7f3k9qx2"])
        XCTAssertEqual(model.timeline, StatusTimeline(record: applied))
        XCTAssertFalse(model.isLoading)
        XCTAssertFalse(model.isOffline)
        XCTAssertNil(model.loadError)
        XCTAssertEqual(model.reference, "Ref app-7f3k", "kept as stored, like the submitted screen")
    }

    // MARK: - Criterion 1: a change shows without a refresh

    func testAStatusChangeShowsWithoutARefresh() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(fresh(applied))

        service.push(fresh(deliberated))

        XCTAssertEqual(model.timeline, StatusTimeline(record: deliberated))
        XCTAssertEqual(service.listenedTo.count, 1, "one listener, no reload")
    }

    func testStartingAgainWhileListeningKeepsOneListener() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)

        model.start()
        model.start()

        XCTAssertEqual(service.listenedTo, ["a1"])
    }

    // MARK: - Criterion 2: offline shows the last known status with a banner

    func testAnUpdateFromThePhonesCacheMeansOfflineAndKeepsTheLastStatus() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(fresh(applied))

        service.push(cached(applied))

        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.timeline, StatusTimeline(record: applied))
        XCTAssertEqual(ApplicationStatusViewModel.offlineBanner, "Offline. Showing your last saved status.")
    }

    func testTheBannerGoesWhenTheNetworkComesBack() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(cached(applied))
        XCTAssertTrue(model.isOffline)

        service.push(fresh(deliberated))

        XCTAssertFalse(model.isOffline)
        XCTAssertEqual(model.timeline, StatusTimeline(record: deliberated))
    }

    func testLosingTheNetworkAfterLoadingKeepsTheTimelineAndShowsOffline() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(fresh(applied))

        service.push(.failure(.network))

        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.timeline, StatusTimeline(record: applied))
        XCTAssertNil(model.loadError)
    }

    func testOfflineBeforeAnythingLoadedSaysSoAndStillListens() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()

        service.push(.failure(.network))
        XCTAssertEqual(model.loadError, ApplicationStatusViewModel.message(for: .network))
        XCTAssertFalse(model.isLoading)

        // Firestore keeps listening through a lost connection, so the status arrives once it's back.
        service.push(fresh(applied))
        XCTAssertNil(model.loadError)
        XCTAssertEqual(model.timeline, StatusTimeline(record: applied))
        XCTAssertEqual(service.stopped, 0)
    }

    func testLosingThePhonesConnectionShowsTheBannerOverTheLastStatus() {
        // Firestore only answers from its cache once it decides it's offline, which can take a while,
        // so the phone's own connection counts too.
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(fresh(applied))

        network.set(connected: false)

        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.timeline, StatusTimeline(record: applied))
    }

    func testTheBannerGoesWhenTheConnectionComesBack() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(fresh(applied))
        network.set(connected: false)

        network.set(connected: true)

        XCTAssertFalse(model.isOffline)
    }

    func testTheBannerStaysWhileFirestoreStillAnswersFromTheCache() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(cached(applied))

        network.set(connected: true)

        XCTAssertTrue(model.isOffline, "the connection is back but the status hasn't been confirmed by the server yet")
        service.push(fresh(applied))
        XCTAssertFalse(model.isOffline)
    }

    func testAnUpdateFromTheServerProvesTheConnectionIsBack() {
        // The network watch can miss the connection coming back (it does in the simulator), but a fresh
        // answer from the server can only arrive over a working connection.
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()
        service.push(fresh(applied))
        network.set(connected: false)
        XCTAssertTrue(model.isOffline)

        service.push(fresh(deliberated))

        XCTAssertFalse(model.isOffline)
        XCTAssertEqual(model.timeline, StatusTimeline(record: deliberated))
    }

    func testStartingAgainWatchesTheNetworkOnce() {
        let service = FakeStatusService()
        var model: ApplicationStatusViewModel? = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model?.start()
        model?.start()

        model = nil

        XCTAssertEqual(network.stopped, 1)
    }

    // MARK: - Failures and Retry

    func testAnApplicationThatCantBeReadShowsItsMessageAndRetryListensAgain() {
        let service = FakeStatusService()
        let model = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model.start()

        service.push(.failure(.notFound))
        XCTAssertEqual(model.loadError, ApplicationStatusViewModel.message(for: .notFound))
        XCTAssertNil(model.timeline)

        model.retry()
        XCTAssertEqual(service.listenedTo, ["a1", "a1"])
        XCTAssertTrue(model.isLoading)
        XCTAssertNil(model.loadError)
    }

    func testEachFailureHasAPlainMessage() {
        XCTAssertEqual(ApplicationStatusViewModel.message(for: .network), "We couldn't load your application. Check your connection and try again.")
        XCTAssertEqual(ApplicationStatusViewModel.message(for: .notFound), "We couldn't find this application. It may have been removed.")
        XCTAssertEqual(ApplicationStatusViewModel.message(for: .unavailable), "We couldn't load your application right now. Try again in a moment.")
    }

    // MARK: - The listener goes with the screen

    func testLettingGoOfTheScreenStopsItsListener() {
        let service = FakeStatusService()
        var model: ApplicationStatusViewModel? = ApplicationStatusViewModel(applicationID: "a1", service: service, network: network)
        model?.start()

        model = nil

        XCTAssertNil(model)
        XCTAssertEqual(service.stopped, 1)
    }
}
