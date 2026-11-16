import XCTest
@testable import AgenticLender

/// The support request form (AL-149, Figma 20 to 21a) and the request it sends to
/// `POST /core/support-requests` (contract agreed with al-core: category, subject 1 to 100,
/// message 1 to 2,000; the form keeps to Figma's 1,000).
final class SupportFormTests: XCTestCase {
    private func filled(
        category: SupportCategory? = .application,
        subject: String = "Can't see my valuation",
        message: String = "I checked a property yesterday but it isn't in my saved list any more.",
        includeApplication: Bool = false
    ) -> SupportForm {
        SupportForm(category: category, subject: subject, message: message, includeApplication: includeApplication)
    }

    // MARK: - Criterion 1: required fields (Figma 20a)

    func testAnEmptyFormNamesEveryMissingField() {
        let errors = SupportForm().errors

        XCTAssertEqual(errors, [
            .category: "Choose a category",
            .subject: "Add a subject",
            .message: "Tell us what's happening",
        ])
    }

    func testSpacesOnlyCountAsEmpty() {
        let errors = filled(subject: "   ", message: "\n  ").errors

        XCTAssertEqual(errors[.subject], "Add a subject")
        XCTAssertEqual(errors[.message], "Tell us what's happening")
    }

    func testAFilledFormHasNoErrors() {
        XCTAssertEqual(filled().errors, [:])
    }

    func testTooLongASubjectOrMessageIsAnError() {
        let errors = filled(
            subject: String(repeating: "a", count: SupportForm.maxSubjectLength + 1),
            message: String(repeating: "a", count: SupportForm.maxMessageLength + 1)
        ).errors

        XCTAssertEqual(errors[.subject], "Keep the subject to 100 characters")
        XCTAssertEqual(errors[.message], "Keep the message to 1,000 characters")
    }

    func testTheCounterShowsCharactersUsed() {
        XCTAssertEqual(filled(message: "Hello").messageCount, "5 / 1,000")
    }

    // MARK: - The request body

    func testTheBodyHasTheTrimmedFieldsAndCategory() throws {
        let body = try XCTUnwrap(filled(category: .payment, subject: " Fee ", message: " Charged twice \n").body(applicationID: nil))
        let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]

        XCTAssertEqual(json?["category"] as? String, "payment")
        XCTAssertEqual(json?["subject"] as? String, "Fee")
        XCTAssertEqual(json?["message"] as? String, "Charged twice")
        XCTAssertNil(json?["application_id"])
    }

    func testTheApplicationIsSentOnlyWhenTheToggleIsOn() throws {
        let on = try JSONSerialization.jsonObject(
            with: XCTUnwrap(filled(includeApplication: true).body(applicationID: "app-applied"))
        ) as? [String: Any]
        let off = try JSONSerialization.jsonObject(
            with: XCTUnwrap(filled(includeApplication: false).body(applicationID: "app-applied"))
        ) as? [String: Any]

        XCTAssertEqual(on?["application_id"] as? String, "app-applied")
        XCTAssertNil(off?["application_id"])
    }

    func testAnInvalidFormHasNoBody() {
        XCTAssertNil(SupportForm().body(applicationID: nil))
    }

    // MARK: - Categories (Figma 20b)

    func testTheCategoriesAreTheFourAgreedWithAlCore() {
        XCTAssertEqual(SupportCategory.allCases.map(\.rawValue), ["account", "application", "payment", "other"])
        XCTAssertEqual(SupportCategory.allCases.map(\.title), ["Account", "Application", "Payment", "Other"])
    }
}
