import XCTest
@testable import AgenticLender

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testGreetsTheBorrowerByFirstName() {
        let home = HomeViewModel(profile: .aliceWithBob)

        XCTAssertEqual(home.greeting, "Hello, Alice")
    }

    func testFirstNameIsTheFirstWordOfTheFullName() {
        XCTAssertEqual(HomeViewModel.firstName(from: "Aoife Byrne"), "Aoife")
        XCTAssertEqual(HomeViewModel.firstName(from: "  Seán  Ó Briain "), "Seán")
        XCTAssertEqual(HomeViewModel.firstName(from: "Cher"), "Cher")
        XCTAssertNil(HomeViewModel.firstName(from: "   "))
    }

    func testABlankNameKeepsThePlainGreeting() {
        let home = HomeViewModel(profile: CoreProfile(fullName: "  ", brokerID: nil, brokerName: nil, brokerFirm: nil))

        XCTAssertEqual(home.greeting, "Hello")
    }

    func testShowsTheChosenBrokerAndFirm() {
        let home = HomeViewModel(profile: .aliceWithBob)

        XCTAssertEqual(home.brokerName, "Bob Murphy")
        XCTAssertEqual(home.brokerFirm, "Murphy Mortgages")
    }

    func testChangingBrokerUpdatesTheCard() {
        let home = HomeViewModel(profile: .aliceWithBob)
        let changed = CoreProfile(
            fullName: "Alice Byrne", brokerID: "broker2", brokerName: "Ciara Kelly", brokerFirm: "Kelly Financial"
        )

        home.brokerChanged(changed)

        XCTAssertEqual(home.brokerName, "Ciara Kelly")
        XCTAssertEqual(home.brokerFirm, "Kelly Financial")
        XCTAssertEqual(home.profile, changed)
    }
}
