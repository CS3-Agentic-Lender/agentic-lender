import XCTest
@testable import AgenticLender

/// A fake live list of the borrower's applications: lets a test push updates.
@MainActor
private final class FakeHomeApplicationService: HomeApplicationService {
    private(set) var listens = 0
    private(set) var stopped = 0
    private var onChange: ((Result<HomeApplication?, ApplicationStatusError>) -> Void)?

    func listen(onChange: @escaping (Result<HomeApplication?, ApplicationStatusError>) -> Void) -> LiveListener {
        listens += 1
        self.onChange = onChange
        return LiveListener { [weak self] in self?.stopped += 1 }
    }

    func push(_ result: Result<HomeApplication?, ApplicationStatusError>) {
        onChange?(result)
    }
}

/// The application card on Home (AL-104, Figma Home and 14f).
final class HomeApplicationTests: XCTestCase {
    private let earlier = Date(timeIntervalSince1970: 1_793_000_000)
    private let later = Date(timeIntervalSince1970: 1_793_100_000)

    private func fields(status: String, loanType: String = "mortgage", amount: Double? = 210_000, term: Int? = 30, created: Date? = nil) -> [String: Any] {
        var fields: [String: Any] = ["status": status, "loanType": loanType]
        fields["loanAmountEur"] = amount
        fields["termYears"] = term
        fields["createdAt"] = created
        return fields
    }

    func testReadsAnApplication() throws {
        let app = try XCTUnwrap(HomeApplication(id: "a1", fields: fields(status: "AI Deliberated", created: earlier)))

        XCTAssertEqual(app.id, "a1")
        XCTAssertEqual(app.status, .aiDeliberated)
        XCTAssertEqual(app.loanType, .mortgage)
        XCTAssertEqual(app.createdAt, earlier)
    }

    func testAStatusTheAppDoesNotKnowIsNotShown() {
        XCTAssertNil(HomeApplication(id: "a1", fields: fields(status: "Approved")))
    }

    func testTheNewestApplicationIsTheOneShown() throws {
        let old = try XCTUnwrap(HomeApplication(id: "old", fields: fields(status: "Declined", created: earlier)))
        let new = try XCTUnwrap(HomeApplication(id: "new", fields: fields(status: "Applied", created: later)))

        XCTAssertEqual(HomeApplication.newest(of: [old, new])?.id, "new")
        XCTAssertNil(HomeApplication.newest(of: []))
    }

    // MARK: - What the card says (Figma Home, 14f)

    func testTheCardMatchesTheFigmaForAnAIReview() throws {
        let app = try XCTUnwrap(HomeApplication(id: "a1", fields: fields(status: "AI Deliberated")))

        XCTAssertEqual(app.badge, StatusTimeline.Badge(text: "AI review", tone: .tint))
        XCTAssertEqual(app.terms, "€210,000 · 30 years")
        XCTAssertEqual(app.detail, "The AI credit committee has reviewed it. The underwriter decides next.")
    }

    func testEveryStatusHasABadgeAndANextStep() throws {
        let expected: [(String, String, String)] = [
            ("Draft", "Draft", "Saved as a draft. It isn't submitted yet."),
            ("Applied", "Submitted", "The AI credit committee is reviewing it."),
            ("Underwriter Approved", "Approved", "Approved. Your loan note is minted next."),
            ("Declined", "Declined", "Declined. View status for the reason."),
            ("Funded", "Funded", "Your loan note has been minted."),
            ("Closed", "Closed", "This application is closed."),
        ]
        for (status, badge, detail) in expected {
            let app = try XCTUnwrap(HomeApplication(id: "a1", fields: fields(status: status)))
            XCTAssertEqual(app.badge.text, badge, status)
            XCTAssertEqual(app.detail, detail, status)
            XCTAssertEqual(app.badge.tone, app.status.tone, "palette A, like the portal")
        }
    }

    func testAHELOCShowsItsCreditLine() throws {
        let app = try XCTUnwrap(HomeApplication(id: "a1", fields: fields(status: "Applied", loanType: "heloc", amount: 90_000, term: 20)))

        XCTAssertEqual(app.terms, "€90,000 credit line · 20 years")
    }

    func testADraftWithNoAmountYetShowsNoTerms() throws {
        let app = try XCTUnwrap(HomeApplication(id: "a1", fields: fields(status: "Draft", amount: nil, term: nil)))

        XCTAssertNil(app.terms)
    }
}

@MainActor
final class HomeApplicationCardModelTests: XCTestCase {
    private func app(_ status: String) -> HomeApplication {
        HomeApplication(id: "a1", fields: ["status": status, "loanType": "mortgage", "loanAmountEur": 210_000.0, "termYears": 30])!
    }

    func testListensOnceAndShowsTheApplication() {
        let service = FakeHomeApplicationService()
        let model = HomeApplicationCardModel(service: service)

        model.start()
        model.start()
        XCTAssertEqual(model.state, .loading)

        service.push(.success(app("Applied")))

        XCTAssertEqual(service.listens, 1)
        XCTAssertEqual(model.state, .application(app("Applied")))
    }

    func testNoApplicationShowsTheStartCard() {
        let service = FakeHomeApplicationService()
        let model = HomeApplicationCardModel(service: service)
        model.start()

        service.push(.success(nil))

        XCTAssertEqual(model.state, .none)
        XCTAssertEqual(HomeApplicationCardModel.noApplicationText, "Start by checking what you could borrow. It takes about two minutes.")
    }

    // MARK: - Criterion 3: the card updates live

    func testAStatusChangeShowsWithoutAReload() {
        let service = FakeHomeApplicationService()
        let model = HomeApplicationCardModel(service: service)
        model.start()
        service.push(.success(app("Applied")))

        service.push(.success(app("AI Deliberated")))

        XCTAssertEqual(model.state, .application(app("AI Deliberated")))
        XCTAssertEqual(service.listens, 1)
    }

    func testAFailureSaysSoAndRetryListensAgain() {
        let service = FakeHomeApplicationService()
        let model = HomeApplicationCardModel(service: service)
        model.start()

        service.push(.failure(.unavailable))
        XCTAssertEqual(model.state, .failed("We couldn't load your application right now. Try again in a moment."))

        model.retry()
        XCTAssertEqual(service.listens, 2)
        XCTAssertEqual(model.state, .loading)
    }

    func testLettingGoOfTheCardStopsItsListener() {
        let service = FakeHomeApplicationService()
        var model: HomeApplicationCardModel? = HomeApplicationCardModel(service: service)
        model?.start()

        model = nil

        XCTAssertEqual(service.stopped, 1)
    }
}
