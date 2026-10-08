import XCTest
@testable import AgenticLender

final class BorrowerProfileTests: XCTestCase {
    private let form = SignUpForm(
        fullName: "  Alice Murphy ",
        email: " Alice@Test.com ",
        password: TestFixtures.password,
        phone: "087 123 4567",
        addressLine1: " 12 Oak Park ",
        addressLine2: "  ",
        county: .cork,
        eircode: "a65f4e2"
    )

    func testBuildsTheProfileSavedToFirestore() throws {
        let profile = try XCTUnwrap(BorrowerProfile(uid: "uid-1", form: form))

        XCTAssertEqual(profile.uid, "uid-1")
        XCTAssertEqual(profile.role, "borrower")
        XCTAssertEqual(profile.fullName, "Alice Murphy")
        XCTAssertEqual(profile.email, "alice@test.com")
        XCTAssertEqual(profile.phone, "+353871234567")
        XCTAssertEqual(profile.addressLine1, "12 Oak Park")
        XCTAssertEqual(profile.county, "Cork")
    }

    func testSavesTheEircodeInCapitalsWithASpace() throws {
        let profile = try XCTUnwrap(BorrowerProfile(uid: "uid-1", form: form))

        XCTAssertEqual(profile.eircode, "A65 F4E2")
    }

    func testLeavesOutAnEmptyAddressLine2() throws {
        let profile = try XCTUnwrap(BorrowerProfile(uid: "uid-1", form: form))

        XCTAssertNil(profile.addressLine2)
    }

    func testIsNilWhenTheFormIsInvalid() {
        var invalid = form
        invalid.eircode = "nope"

        XCTAssertNil(BorrowerProfile(uid: "uid-1", form: invalid))
    }
}
