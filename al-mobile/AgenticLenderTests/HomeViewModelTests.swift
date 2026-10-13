import XCTest
@testable import AgenticLender

@MainActor
final class HomeViewModelTests: XCTestCase {
    private func model(fullName: Result<String, AccountError> = .success("Aoife Byrne")) -> HomeViewModel {
        HomeViewModel(loadFullName: { try fullName.get() })
    }

    func testGreetsTheBorrowerByFirstNameOnceTheProfileLoads() async {
        let home = model()

        await home.load()

        XCTAssertEqual(home.greeting, "Hello, Aoife")
        XCTAssertFalse(home.isLoading)
    }

    func testIsLoadingUntilTheNameArrives() {
        let home = model()

        XCTAssertTrue(home.isLoading)
        XCTAssertEqual(home.greeting, "Hello")
    }

    func testFallsBackToAPlainGreetingWhenTheProfileCantBeRead() async {
        for failure in [AccountError.network, .unknown] {
            let home = model(fullName: .failure(failure))

            await home.load()

            XCTAssertEqual(home.greeting, "Hello", "\(failure)")
            XCTAssertFalse(home.isLoading, "\(failure)")
        }
    }

    func testFirstNameIsTheFirstWordOfTheFullName() {
        XCTAssertEqual(HomeViewModel.firstName(from: "Aoife Byrne"), "Aoife")
        XCTAssertEqual(HomeViewModel.firstName(from: "  Seán  Ó Briain "), "Seán")
        XCTAssertEqual(HomeViewModel.firstName(from: "Cher"), "Cher")
        XCTAssertNil(HomeViewModel.firstName(from: "   "))
    }

    func testABlankNameKeepsThePlainGreeting() async {
        let home = model(fullName: .success("  "))

        await home.load()

        XCTAssertEqual(home.greeting, "Hello")
    }
}
