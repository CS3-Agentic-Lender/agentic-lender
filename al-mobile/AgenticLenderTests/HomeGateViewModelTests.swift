import XCTest
@testable import AgenticLender

/// The gate every route to home goes through: after email sign-up, after a Google user saves
/// "Your details", after sign-in, and when the app opens already signed in.
@MainActor
final class HomeGateViewModelTests: XCTestCase {
    func testABorrowerWithoutABrokerMustChooseOneBeforeHome() async {
        let service = FakeProfileService()
        service.profileResult = .success(.alice)
        let gate = HomeGateViewModel(service: service)

        await gate.load()

        XCTAssertEqual(gate.state, .chooseBroker)
    }

    func testAnEmptyBrokerNameAlsoMeansChoose() async {
        let service = FakeProfileService()
        service.profileResult = .success(CoreProfile(fullName: "Alice Byrne", brokerID: "gone", brokerName: "", brokerFirm: nil))
        let gate = HomeGateViewModel(service: service)

        await gate.load()

        XCTAssertEqual(gate.state, .chooseBroker)
    }

    func testABorrowerWithABrokerGoesStraightHome() async {
        let service = FakeProfileService()
        service.profileResult = .success(.aliceWithBob)
        let gate = HomeGateViewModel(service: service)

        await gate.load()

        XCTAssertEqual(gate.state, .home(.aliceWithBob))
    }

    func testChoosingABrokerOpensHome() async {
        let gate = HomeGateViewModel(service: FakeProfileService())
        await gate.load()

        gate.brokerChosen(.aliceWithBob)

        XCTAssertEqual(gate.state, .home(.aliceWithBob))
    }

    func testIsLoadingUntilTheProfileArrives() {
        XCTAssertEqual(HomeGateViewModel(service: FakeProfileService()).state, .loading)
    }

    func testAProfileThatCantLoadNeverOpensHomeAndRetryLoadsAgain() async {
        let service = FakeProfileService()
        service.profileResult = .failure(.network)
        let gate = HomeGateViewModel(service: service)

        await gate.load()
        XCTAssertEqual(gate.state, .failed(CommonMessage.cantReachServer))

        service.profileResult = .failure(.unknown)
        await gate.load()
        XCTAssertEqual(gate.state, .failed(HomeGateViewModel.loadFailedMessage))

        service.profileResult = .success(.aliceWithBob)
        await gate.load()
        XCTAssertEqual(gate.state, .home(.aliceWithBob))
        XCTAssertEqual(service.profileLoads, 3)
    }
}
