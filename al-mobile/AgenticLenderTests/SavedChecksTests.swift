import XCTest
@testable import AgenticLender

/// A fake store of saved checks: lets a test push list updates, and records saves and deletes.
@MainActor
final class FakeSavedCheckService: SavedCheckService {
    var saveResult: Result<String, SavedCheckError> = .success("c1")
    var deleteError: SavedCheckError?
    private(set) var saved: [SavedCheckDraft] = []
    private(set) var deleted: [String] = []
    private(set) var listens = 0
    private(set) var stopped = 0
    private var onChange: ((Result<[SavedCheck], SavedCheckError>) -> Void)?

    func save(_ draft: SavedCheckDraft) async throws -> String {
        saved.append(draft)
        return try saveResult.get()
    }

    func delete(id: String) async throws {
        deleted.append(id)
        if let deleteError { throw deleteError }
    }

    func listen(onChange: @escaping (Result<[SavedCheck], SavedCheckError>) -> Void) -> SavedChecksListener {
        listens += 1
        self.onChange = onChange
        return SavedChecksListener { [weak self] in self?.stopped += 1 }
    }

    func push(_ result: Result<[SavedCheck], SavedCheckError>) {
        onChange?(result)
    }
}

enum SavedCheckFixtures {
    static func check(id: String = "c1", county: String = "Cork", askingPrice: Double? = 379_000) -> SavedCheck {
        var property: [String: Any] = [
            "county": county, "eircode": "T12 X8Y2", "propertyType": "Semi-D",
            "bedrooms": 3, "floorAreaSqm": 110.0, "berRating": "B3",
        ]
        property["askingPriceEur"] = askingPrice
        var fields: [String: Any] = ["property": property, "estimatedValueEur": 345_000.0, "modelVersion": "v2"]
        fields["priceNeedsReview"] = askingPrice == nil ? nil : true
        return SavedCheck(id: id, fields: fields)!
    }

    static func draft() -> SavedCheckDraft {
        let request = ValuationRequest(form: PropertyCheckForm(
            county: .cork, eircode: "T12 X8Y2", floorArea: "110", bedrooms: 3,
            propertyType: .semiDetached, berRating: .b3, askingPrice: ""
        ))!
        let result = ValuationResult(
            estimateEur: 345_000, displayEstimateEur: 345_000, basis: "2024 asking-price estimate",
            supportWarnings: [], askingPriceGap: nil, priceNeedsReview: nil, modelVersion: "v2",
            baselineEur: nil, contributions: nil
        )
        return SavedCheckDraft(request: request, result: result)
    }
}

/// The Properties list (Figma 09, 09a): the borrower's saved checks, live, and deleting one (AL-144).
@MainActor
final class SavedChecksStoreTests: XCTestCase {
    func testListensOnceAndShowsTheChecksAsTheyArrive() {
        let service = FakeSavedCheckService()
        let store = SavedChecksStore(service: service)

        store.start()
        store.start()
        XCTAssertEqual(service.listens, 1)
        XCTAssertEqual(store.state, .loading)

        service.push(.success([]))
        XCTAssertEqual(store.state, .ready([]))

        let cork = SavedCheckFixtures.check()
        service.push(.success([cork]))
        XCTAssertEqual(store.checks, [cork])
    }

    func testALostListenerShowsAMessageAndRetryListensAgain() {
        let service = FakeSavedCheckService()
        let store = SavedChecksStore(service: service)
        store.start()

        service.push(.failure(.network))
        XCTAssertEqual(store.state, .failed("We couldn't load your properties. Check your connection and try again."))

        store.start()
        XCTAssertEqual(service.listens, 2)
        XCTAssertEqual(store.state, .loading)
    }

    func testLettingGoOfTheStoreStopsItsListener() {
        let service = FakeSavedCheckService()
        var store: SavedChecksStore? = SavedChecksStore(service: service)
        store?.start()

        store = nil

        XCTAssertEqual(service.stopped, 1)
    }

    func testDeletingSendsTheChecksID() async {
        let service = FakeSavedCheckService()
        let store = SavedChecksStore(service: service)

        await store.delete(SavedCheckFixtures.check(id: "c7"))

        XCTAssertEqual(service.deleted, ["c7"])
        XCTAssertNil(store.deleteError)
    }

    func testADeleteThatFailsSaysSoAndTheNextOneClearsIt() async {
        let service = FakeSavedCheckService()
        let store = SavedChecksStore(service: service)
        service.deleteError = .network

        await store.delete(SavedCheckFixtures.check())
        XCTAssertEqual(store.deleteError, "We couldn't delete that property. Check your connection and try again.")

        service.deleteError = nil
        await store.delete(SavedCheckFixtures.check())
        XCTAssertNil(store.deleteError)
    }

    func testEachListFailureHasAPlainMessage() {
        XCTAssertEqual(SavedChecksStore.message(for: .signedOut), "You've been signed out. Sign in again to see your properties.")
        XCTAssertEqual(SavedChecksStore.message(for: .unavailable), "We couldn't load your properties right now. Try again in a moment.")
    }
}

/// "Save this property" on the result screen (Figma 11d).
@MainActor
final class SaveCheckModelTests: XCTestCase {
    func testSavingSendsTheCheckOnceAndThenShowsSaved() async {
        let service = FakeSavedCheckService()
        let model = SaveCheckModel(draft: SavedCheckFixtures.draft(), service: service)

        await model.save()
        await model.save()

        XCTAssertEqual(model.state, .saved)
        XCTAssertEqual(service.saved, [SavedCheckFixtures.draft()])
    }

    func testAtTheLimitItSaysToDeleteOne() async {
        let service = FakeSavedCheckService()
        service.saveResult = .failure(.limitReached)
        let model = SaveCheckModel(draft: SavedCheckFixtures.draft(), service: service)

        await model.save()

        XCTAssertEqual(model.state, .failed("You've saved 20 properties, the most you can keep. Delete one in Properties to save this one."))
    }

    func testAFailedSaveCanBeTriedAgain() async {
        let service = FakeSavedCheckService()
        service.saveResult = .failure(.network)
        let model = SaveCheckModel(draft: SavedCheckFixtures.draft(), service: service)

        await model.save()
        XCTAssertEqual(model.state, .failed("We couldn't save this property. Check your connection and try again."))

        service.saveResult = .success("c2")
        await model.save()
        XCTAssertEqual(model.state, .saved)
        XCTAssertEqual(service.saved.count, 2)
    }

    func testEachSaveFailureHasAPlainMessage() {
        XCTAssertEqual(SaveCheckModel.message(for: .signedOut), "You've been signed out. Sign in again to save this property.")
        XCTAssertEqual(SaveCheckModel.message(for: .unavailable), "We couldn't save this property right now. Try again in a moment.")
    }
}
