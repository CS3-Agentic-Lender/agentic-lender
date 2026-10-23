import XCTest
@testable import AgenticLender

/// An application as `GET /core/applications/{id}` returns it, and how it fills the form back in.
final class StoredApplicationTests: XCTestCase {
    func testReadsTheStatusAndWhetherItIsStillADraft() throws {
        XCTAssertTrue(try TestFixtures.storedApplication(status: "Draft").isDraft)
        XCTAssertFalse(try TestFixtures.storedApplication(status: "Applied").isDraft)
        XCTAssertEqual(try TestFixtures.storedApplication(status: "Draft").id, "app42")
    }

    func testFillsTheFormsOwnFieldsWithTheSavedValues() throws {
        let stored = try TestFixtures.storedApplication(status: "Draft")

        let form = stored.filling(TestFixtures.applicationForm())

        XCTAssertEqual(form.loanAmount, "210,000")
        XCTAssertEqual(form.termYears, 30)
        XCTAssertEqual(form.employment, .selfEmployed)
        XCTAssertEqual(form.yearsInCurrentJob, 4)
        XCTAssertEqual(form.monthlyTakeHome, "3,650")
        XCTAssertEqual(form.monthlyLivingCosts, "1,400")
        XCTAssertEqual(form.property, ApplicationProperty(
            addressLine1: "12 Model Farm Road",
            addressLine2: "Bishopstown",
            eircode: "T12 X8Y2",
            county: .cork,
            askingPrice: "380,000",
            propertyType: .semiDetached,
            bedrooms: 3,
            floorArea: "98",
            berRating: .c2
        ))
    }

    func testKeepsTheAnswersFromTheNewAffordabilityCheck() throws {
        let start = TestFixtures.applicationForm()

        let form = try TestFixtures.storedApplication(status: "Draft").filling(start)

        XCTAssertEqual(form.affordability, start.affordability)
        XCTAssertEqual(form.maxLoanEur, start.maxLoanEur)
        XCTAssertEqual(form.loanType, start.loanType)
    }

    func testFieldsTheDraftHasNotFilledInStayAsTheyWere() throws {
        let json = #"{"id": "app1", "status": "Draft", "loan_type": "mortgage", "property": {"property_type": "semi_detached"}}"#
        let stored = try JSONDecoder().decode(StoredApplication.self, from: Data(json.utf8))
        let start = TestFixtures.applicationForm()

        let form = stored.filling(start)

        XCTAssertEqual(form, start, "an unknown property type is left for the borrower to choose")
    }
}
