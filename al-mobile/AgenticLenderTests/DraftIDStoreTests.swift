import XCTest
@testable import AgenticLender

/// The draft id kept on the phone, one per signed-in borrower.
final class DraftIDStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suite = "DraftIDStoreTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testRemembersAndForgetsTheDraftID() {
        let store = UserDefaultsDraftIDStore(userID: "u1", defaults: defaults)
        XCTAssertNil(store.draftID())

        store.remember("app42")
        XCTAssertEqual(UserDefaultsDraftIDStore(userID: "u1", defaults: defaults).draftID(), "app42")

        store.forget()
        XCTAssertNil(store.draftID())
    }

    func testEachBorrowerHasTheirOwnDraft() {
        UserDefaultsDraftIDStore(userID: "u1", defaults: defaults).remember("app42")

        XCTAssertNil(UserDefaultsDraftIDStore(userID: "u2", defaults: defaults).draftID())
    }
}
