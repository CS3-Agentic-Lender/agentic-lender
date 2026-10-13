import XCTest
@testable import AgenticLender

final class EmailTests: XCTestCase {
    func testAcceptsAPlainEmail() {
        XCTAssertTrue(Email.isValid("alice@test.com"))
        XCTAssertTrue(Email.isValid(" alice.murphy+loans@mail.example.ie "))
    }

    func testRejectsMalformedEmails() {
        for email in ["alice", "alice@", "@test.com", "alice@test", "alice @test.com", "alice@test.c"] {
            XCTAssertFalse(Email.isValid(email), email)
        }
    }

    func testNormalisesToTrimmedLowerCase() {
        XCTAssertEqual(Email.normalized(" Alice@Test.COM "), "alice@test.com")
    }

    func testErrorAsksForAnEmailWhenBlank() {
        XCTAssertEqual(Email.error(for: "  "), "Enter your email")
    }

    func testErrorShowsTheFormatWhenMalformed() {
        XCTAssertEqual(Email.error(for: "alice@test"), "Enter an email like name@example.com")
    }

    func testNoErrorForAValidEmail() {
        XCTAssertNil(Email.error(for: "alice@test.com"))
    }
}
