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

    func testBuildsTheCleanedUpProfile() throws {
        let profile = try XCTUnwrap(BorrowerProfile(form: form))

        XCTAssertEqual(profile.fullName, "Alice Murphy")
        XCTAssertEqual(profile.email, "alice@test.com")
        XCTAssertEqual(profile.phone, "+353871234567")
        XCTAssertEqual(profile.addressLine1, "12 Oak Park")
        XCTAssertEqual(profile.county, "Cork")
    }

    func testSendsTheEircodeInCapitalsWithASpace() throws {
        let profile = try XCTUnwrap(BorrowerProfile(form: form))

        XCTAssertEqual(profile.eircode, "A65 F4E2")
    }

    func testLeavesOutAnEmptyAddressLine2() throws {
        let profile = try XCTUnwrap(BorrowerProfile(form: form))

        XCTAssertNil(profile.addressLine2)
    }

    func testIsNilWhenTheFormIsInvalid() {
        var invalid = form
        invalid.eircode = "nope"

        XCTAssertNil(BorrowerProfile(form: invalid))
    }

    func testNeedsNoPasswordBecauseAGoogleUserHasNone() throws {
        var google = form
        google.password = ""

        let profile = try XCTUnwrap(BorrowerProfile(form: google))

        XCTAssertEqual(profile.email, "alice@test.com")
    }

    // MARK: - POST /core/me body (field names agreed with Dumi on AL-220)

    func testBodyUsesTheAgreedSnakeCaseFieldNames() throws {
        var withSecondLine = form
        withSecondLine.addressLine2 = "Ballintemple"
        let profile = try XCTUnwrap(BorrowerProfile(form: withSecondLine))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: profile.body()) as? [String: String])

        XCTAssertEqual(body, [
            "full_name": "Alice Murphy",
            "email": "alice@test.com",
            "phone": "+353871234567",
            "address_line_1": "12 Oak Park",
            "address_line_2": "Ballintemple",
            "county": "Cork",
            "eircode": "A65 F4E2",
        ])
    }

    func testBodyLeavesOutAnEmptyAddressLine2AndNeverSendsARole() throws {
        let profile = try XCTUnwrap(BorrowerProfile(form: form))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: profile.body()) as? [String: Any])

        XCTAssertNil(body["address_line_2"])
        XCTAssertNil(body["role"])
        XCTAssertNil(body["uid"])
    }
}
