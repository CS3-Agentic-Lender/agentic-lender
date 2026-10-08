import XCTest
@testable import AgenticLender

final class SignUpValidatorTests: XCTestCase {
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

    // MARK: - Whole form

    func testValidFormHasNoErrors() {
        XCTAssertEqual(SignUpValidator.errors(for: validForm()), [:])
    }

    func testEveryFieldExceptAddressLine2IsRequired() {
        let errors = SignUpValidator.errors(for: SignUpForm())

        // SignUpField has no case for address line 2, so it can never show an error.
        XCTAssertEqual(Set(errors.keys), Set(SignUpField.allCases))
    }

    func testBlankSpacesCountAsEmpty() {
        var form = validForm()
        form.fullName = "   "

        XCTAssertEqual(SignUpValidator.errors(for: form)[.fullName], "Enter your full name")
    }

    func testAddressLine2IsOptional() {
        var form = validForm()
        form.addressLine2 = ""

        XCTAssertEqual(SignUpValidator.errors(for: form), [:])
    }

    func testMissingCountyAsksToChooseOne() {
        var form = validForm()
        form.county = nil

        XCTAssertEqual(SignUpValidator.errors(for: form)[.county], "Choose your county")
    }

    // MARK: - Steps

    func testAccountStepOnlyChecksNameEmailAndPassword() {
        let errors = SignUpValidator.errors(for: SignUpForm(), on: .account)

        XCTAssertEqual(Set(errors.keys), [.fullName, .email, .password])
    }

    func testDetailsStepOnlyChecksContactAndAddress() {
        let errors = SignUpValidator.errors(for: SignUpForm(), on: .details)

        XCTAssertEqual(Set(errors.keys), [.phone, .addressLine1, .county, .eircode])
    }

    // MARK: - Password

    func testMissingPasswordAsksForOne() {
        var form = validForm()
        form.password = ""

        XCTAssertEqual(SignUpValidator.errors(for: form)[.password], "Enter a password")
    }

    func testWeakPasswordIsRejected() {
        var form = validForm()
        form.password = TestFixtures.lettersOnlyPassword

        XCTAssertEqual(
            SignUpValidator.errors(for: form)[.password],
            "Use at least 8 characters, with a letter and a number"
        )
    }

    // MARK: - Email

    func testAcceptsAPlainEmail() {
        XCTAssertTrue(SignUpValidator.isValidEmail("alice@test.com"))
        XCTAssertTrue(SignUpValidator.isValidEmail(" alice.murphy+loans@mail.example.ie "))
    }

    func testRejectsMalformedEmails() {
        for email in ["alice", "alice@", "@test.com", "alice@test", "alice @test.com", "alice@test.c"] {
            XCTAssertFalse(SignUpValidator.isValidEmail(email), email)
        }
    }

    func testInvalidEmailShowsFormatError() {
        var form = validForm()
        form.email = "alice@test"

        XCTAssertEqual(
            SignUpValidator.errors(for: form)[.email],
            "Enter an email like name@example.com"
        )
    }

    // MARK: - Irish phone

    func testAcceptsIrishMobileNumbers() {
        for phone in ["087 123 4567", "0871234567", "083-123-4567", "+353 87 123 4567", "00353871234567"] {
            XCTAssertNotNil(SignUpValidator.normalizedIrishPhone(phone), phone)
        }
    }

    func testAcceptsIrishLandlines() {
        for phone in ["01 234 5678", "021 123 4567", "+353 1 234 5678"] {
            XCTAssertNotNil(SignUpValidator.normalizedIrishPhone(phone), phone)
        }
    }

    func testRejectsNumbersThatAreNotIrish() {
        for phone in ["087 123", "12345", "0044 20 7946 0958", "+44 20 7946 0958", "087 123 45678", "phone"] {
            XCTAssertNil(SignUpValidator.normalizedIrishPhone(phone), phone)
        }
    }

    func testPhoneIsNormalisedToInternationalFormat() {
        XCTAssertEqual(SignUpValidator.normalizedIrishPhone("087 123 4567"), "+353871234567")
        XCTAssertEqual(SignUpValidator.normalizedIrishPhone("+353 1 234 5678"), "+35312345678")
    }

    func testInvalidPhoneShowsExample() {
        var form = validForm()
        form.phone = "087 123"

        XCTAssertEqual(
            SignUpValidator.errors(for: form)[.phone],
            "Enter an Irish phone number, like 087 123 4567"
        )
    }

    // MARK: - Eircode

    func testAcceptsEircodeWithAndWithoutSpace() {
        XCTAssertEqual(SignUpValidator.normalizedEircode("A65 F4E2"), "A65 F4E2")
        XCTAssertEqual(SignUpValidator.normalizedEircode("A65F4E2"), "A65 F4E2")
    }

    func testEircodeIsSavedInCapitals() {
        XCTAssertEqual(SignUpValidator.normalizedEircode("a65 f4e2"), "A65 F4E2")
        XCTAssertEqual(SignUpValidator.normalizedEircode(" d6w f4e2 "), "D6W F4E2")
    }

    func testRejectsMalformedEircodes() {
        // Too short, bad routing key letter (B), unique identifier with a disallowed letter (O).
        for eircode in ["A65F4", "B65 F4E2", "A65 F4O2", "A65 F4E22", "12345678", ""] {
            XCTAssertNil(SignUpValidator.normalizedEircode(eircode), eircode)
        }
    }

    func testInvalidEircodeShowsExample() {
        var form = validForm()
        form.eircode = "A65F4"

        XCTAssertEqual(SignUpValidator.errors(for: form)[.eircode], "Enter an Eircode like A65 F4E2")
    }
}
