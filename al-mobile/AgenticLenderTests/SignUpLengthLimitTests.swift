import XCTest
@testable import AgenticLender

/// AL-240: the length limits of al-core's `POST /core/me` (app/me.py): full name 100, email 254,
/// each address line 200, counted after trimming, in Unicode code points as Python counts them.
final class SignUpLengthLimitTests: XCTestCase {
    private func validForm() -> SignUpForm {
        SignUpForm(
            fullName: "Alice Murphy",
            email: "alice@test.com",
            password: TestFixtures.password,
            phone: "087 123 4567",
            addressLine1: "12 Oak Park",
            addressLine2: "",
            county: .cork,
            eircode: "A65 F4E2"
        )
    }

    private func error(_ field: SignUpField, _ change: (inout SignUpForm) -> Void) -> String? {
        var form = validForm()
        change(&form)
        return SignUpValidator.error(for: field, in: form)
    }

    /// An email of exactly `length` characters.
    private func email(length: Int) -> String {
        let domain = "@test.com"
        return String(repeating: "a", count: length - domain.count) + domain
    }

    func testFullNameUpTo100CharactersIsAccepted() {
        XCTAssertNil(error(.fullName) { $0.fullName = String(repeating: "a", count: 100) })
        XCTAssertEqual(error(.fullName) { $0.fullName = String(repeating: "a", count: 101) }, "Use 100 characters or fewer")
    }

    func testEmailUpTo254CharactersIsAccepted() {
        XCTAssertNil(error(.email) { $0.email = email(length: 254) })
        XCTAssertEqual(error(.email) { $0.email = email(length: 255) }, "Use 254 characters or fewer")
    }

    func testAddressLine1UpTo200CharactersIsAccepted() {
        XCTAssertNil(error(.addressLine1) { $0.addressLine1 = String(repeating: "a", count: 200) })
        XCTAssertEqual(error(.addressLine1) { $0.addressLine1 = String(repeating: "a", count: 201) }, "Use 200 characters or fewer")
    }

    func testAddressLine2UpTo200CharactersIsAcceptedAndOtherwiseOptional() {
        XCTAssertNil(error(.addressLine2) { $0.addressLine2 = "" })
        XCTAssertNil(error(.addressLine2) { $0.addressLine2 = String(repeating: "a", count: 200) })
        XCTAssertEqual(error(.addressLine2) { $0.addressLine2 = String(repeating: "a", count: 201) }, "Use 200 characters or fewer")
    }

    func testSpacesAtTheEndsDontCount() {
        XCTAssertNil(error(.fullName) { $0.fullName = "  " + String(repeating: "a", count: 100) + "  " })
    }

    /// "é" typed as e plus a combining accent is one character on screen but two code points,
    /// and al-core counts code points.
    func testAccentsTypedSeparatelyCountTheWayAlCoreCountsThem() {
        let separateAccent = "e\u{301}"
        let fifty = String(repeating: separateAccent, count: 50)
        XCTAssertEqual(fifty.count, 50, "what the borrower sees")

        XCTAssertNil(error(.fullName) { $0.fullName = fifty })
        XCTAssertEqual(error(.fullName) { $0.fullName = fifty + "a" }, "Use 100 characters or fewer")
    }

    func testTheDetailsStepChecksAddressLine2() {
        XCTAssertTrue(SignUpStep.details.fields.contains(.addressLine2))
        XCTAssertTrue(SignUpValidator.profileFields.contains(.addressLine2))
    }

    func testAFormOverALimitMakesNoProfile() {
        var form = validForm()
        form.addressLine2 = String(repeating: "a", count: 201)

        XCTAssertNil(BorrowerProfile(form: form))
    }

    /// Criterion 4: whatever passes is within al-core's limits once trimmed, so it can't get a 422 for length.
    func testAProfileThatPassesIsWithinEveryLimit() throws {
        var form = validForm()
        form.fullName = " " + String(repeating: "a", count: 100) + " "
        form.email = email(length: 254).uppercased()
        form.addressLine1 = String(repeating: "b", count: 200)
        form.addressLine2 = String(repeating: "c", count: 200)

        let profile = try XCTUnwrap(BorrowerProfile(form: form))

        XCTAssertLessThanOrEqual(profile.fullName.unicodeScalars.count, 100)
        XCTAssertLessThanOrEqual(profile.email.unicodeScalars.count, 254)
        XCTAssertLessThanOrEqual(profile.addressLine1.unicodeScalars.count, 200)
        XCTAssertLessThanOrEqual(try XCTUnwrap(profile.addressLine2).unicodeScalars.count, 200)
    }
}
