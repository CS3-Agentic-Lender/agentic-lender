import XCTest
@testable import AgenticLender

/// Who "Your details" is filled in for. al-core rejects a profile whose email differs from the
/// ID token's, so a signed-in user without an email gets no form (Nic on #81).
final class SignedInUserTests: XCTestCase {
    func testASignedInUserWithAnEmailIsUsedForYourDetails() {
        XCTAssertEqual(
            GoogleUser(signedInEmail: "gina@gmail.com", name: "Gina Walsh"),
            GoogleUser(email: "gina@gmail.com", name: "Gina Walsh")
        )
    }

    func testAMissingNameIsLeftEmptyForTheBorrowerToType() {
        XCTAssertEqual(
            GoogleUser(signedInEmail: "gina@gmail.com", name: nil),
            GoogleUser(email: "gina@gmail.com", name: "")
        )
    }

    func testNoEmailMeansNoUserRatherThanAnEmptyEmailAlCoreWouldReject() {
        XCTAssertNil(GoogleUser(signedInEmail: nil, name: "Gina Walsh"))
        XCTAssertNil(GoogleUser(signedInEmail: "", name: "Gina Walsh"))
        XCTAssertNil(GoogleUser(signedInEmail: "  ", name: "Gina Walsh"))
    }
}
