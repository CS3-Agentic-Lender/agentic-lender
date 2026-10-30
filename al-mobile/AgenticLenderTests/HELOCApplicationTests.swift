import XCTest
@testable import AgenticLender

/// The HELOC application (AL-208, Figma 12c): started from the HELOC check, saved with `loan_type: heloc`
/// and the HELOC fields al-core takes, with no deposit and no asking price.
enum HELOCFixtures {
    /// AL-195's test case: Cork, 110 m², 3 bedrooms, semi-detached, B3, €150,000 left, €70,000 income,
    /// €300 debts, 20 years.
    static func request() -> HELOCRequest {
        HELOCRequest(form: HELOCCheckForm(
            county: .cork, propertyType: .semiDetached, floorArea: "110", bedrooms: 3, berRating: .b3,
            mortgageBalance: "150,000", income: "70,000", monthlyDebts: "300", termYears: 20
        ))!
    }

    static func result(maxLine: Double = 98_000) -> HELOCResult {
        HELOCResult(
            homeValueEur: 310_000, maxLineEur: maxLine, combinedLtv: 0.48, monthlyRepaymentEur: 640,
            stressedRepaymentEur: 730, limitedBy: .equity, benchmarkRatePct: 4.1, stressedRatePct: 6.1, rateDate: "2026-09"
        )
    }

    /// A saved HELOC Draft as `GET /core/applications/{id}` returns it.
    static func storedDraft(status: String = "Draft") throws -> StoredApplication {
        let json = """
        {"id": "app77", "status": "\(status)", "loan_type": "heloc", "loan_amount_eur": 80000.0, "term_years": 20,
         "existing_mortgage_balance_eur": 150000.0,
         "property": {"address_line_1": "4 Quay Street", "eircode": "T12 X5R2", "county": "Cork",
                      "property_type": "Semi-D", "bedrooms": 3, "floor_area_sqm": 110.0, "ber_rating": "B3"}}
        """
        return try JSONDecoder().decode(StoredApplication.self, from: Data(json.utf8))
    }

    static func form() -> ApplicationForm {
        ApplicationForm(heloc: request(), result: result())
    }

    /// The form filled in and valid: a €90,000 line, take-home and living costs, and the home's address.
    static func filledForm() -> ApplicationForm {
        var form = form()
        form.loanAmount = "90,000"
        form.monthlyTakeHome = "3,650"
        form.monthlyLivingCosts = "1,400"
        form.property.addressLine1 = "4 Quay Street"
        form.property.eircode = "T12 X5R2"
        return form
    }
}

final class HELOCApplicationFormTests: XCTestCase {
    // MARK: - Criterion 1: pre-filled from the HELOC check

    func testStartsFromTheHELOCCheck() {
        let form = HELOCFixtures.form()

        XCTAssertEqual(form.loanType, .heloc)
        XCTAssertEqual(form.maxLoanEur, 98_000, "the warning compares the line with the maximum line")
        XCTAssertEqual(form.termYears, 20)
        XCTAssertEqual(form.property.county, .cork)
        XCTAssertEqual(form.property.propertyType, .semiDetached)
        XCTAssertEqual(form.property.bedrooms, 3)
        XCTAssertEqual(form.property.floorArea, "110")
        XCTAssertEqual(form.property.berRating, .b3)
        XCTAssertEqual(form.heloc, HELOCDetails(existingMortgageBalanceEur: 150_000, homeValueEur: 310_000))
        XCTAssertFalse(form.isJoint, "single until the borrower says otherwise")
        XCTAssertEqual(form.property.addressLine1, "")
        XCTAssertEqual(form.property.askingPrice, "")
    }

    // MARK: - Criterion 2: no deposit, no asking price

    func testAHELOCNeedsNoAskingPrice() {
        let form = HELOCFixtures.filledForm()

        XCTAssertNil(ApplicationValidator.errors(for: form)[.askingPrice])
        XCTAssertTrue(ApplicationValidator.errors(for: form).isEmpty)
    }

    func testAMortgageStillNeedsItsAskingPrice() {
        var form = TestFixtures.filledApplicationForm()
        form.property.askingPrice = ""

        XCTAssertEqual(ApplicationValidator.errors(for: form)[.askingPrice], "Enter the asking price")
    }

    func testALineAboveTheMaximumIsAWarningNotAnError() {
        var form = HELOCFixtures.filledForm()
        form.loanAmount = "120,000"

        XCTAssertTrue(ApplicationValidator.errors(for: form).isEmpty)
        XCTAssertEqual(ApplicationValidator.loanWarning(for: form), "This is above the €98,000 you could borrow. Your broker may ask you to lower it.")
    }

    // MARK: - Criterion 3: saved with loan_type heloc and the HELOC fields

    func testTheBodyHasTheHELOCFieldsAndNoDepositOrAskingPrice() throws {
        var form = HELOCFixtures.filledForm()
        form.isJoint = true
        let draft = try XCTUnwrap(ApplicationDraft(form: form))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        let property = try XCTUnwrap(body["property"] as? [String: Any])

        XCTAssertEqual(body["loan_type"] as? String, "heloc")
        XCTAssertEqual(body["applicants"] as? String, "joint")
        XCTAssertEqual(body["existing_mortgage_balance_eur"] as? Int, 150_000)
        XCTAssertEqual(body["loan_amount_eur"] as? Int, 90_000, "the credit limit")
        XCTAssertEqual(body["gross_income_eur"] as? Int, 70_000)
        XCTAssertEqual(body["monthly_debts_eur"] as? Int, 300)
        XCTAssertEqual(body["term_years"] as? Int, 20)
        XCTAssertNil(body["deposit_eur"])
        XCTAssertNil(body["first_time_buyer"])
        XCTAssertNil(property["asking_price_eur"], "al-core refuses an asking price on a HELOC")
        XCTAssertEqual(property["eircode"] as? String, "T12 X5R2")
        XCTAssertEqual(property["county"] as? String, "Cork")
        XCTAssertEqual(property["floor_area_sqm"] as? Int, 110)
    }

    func testAMortgageBodyIsUnchanged() throws {
        let draft = try XCTUnwrap(ApplicationDraft(form: TestFixtures.filledApplicationForm()))

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        let property = try XCTUnwrap(body["property"] as? [String: Any])

        XCTAssertEqual(body["applicants"] as? String, "single")
        XCTAssertNil(body["existing_mortgage_balance_eur"])
        XCTAssertEqual(body["deposit_eur"] as? Int, 40_000)
        XCTAssertEqual(property["asking_price_eur"] as? Int, 380_000)
    }

    // MARK: - The review says "estimated value", never "asking price"

    func testTheReviewShowsTheHELOCFigures() throws {
        let review = try XCTUnwrap(ApplicationReview(form: HELOCFixtures.filledForm()))
        let rows = review.cards.flatMap(\.rows)

        XCTAssertTrue(rows.contains(.init(label: "Applying", value: "Single")))
        XCTAssertTrue(rows.contains(.init(label: "Left on your mortgage", value: "€150,000")))
        XCTAssertTrue(rows.contains(.init(label: "Credit line", value: "€90,000")))
        XCTAssertTrue(rows.contains(.init(label: "Estimated value", value: "€310,000")))
        XCTAssertFalse(rows.contains { $0.label == "Asking price" || $0.label == "Deposit" || $0.label == "Loan amount" })
    }

    // MARK: - The home's address from the profile

    func testTheHomeAddressComesFromTheProfileWhenEmpty() {
        let form = HELOCFixtures.form()
        let profile = CoreProfile(
            fullName: "Sean Ryan", brokerID: "b1", brokerName: "Bob", brokerFirm: nil,
            addressLine1: "4 Quay Street", addressLine2: "Ballintemple", county: "Cork", eircode: "T12 X5R2"
        )

        let filled = form.withHomeAddress(from: profile)

        XCTAssertEqual(filled.property.addressLine1, "4 Quay Street")
        XCTAssertEqual(filled.property.addressLine2, "Ballintemple")
        XCTAssertEqual(filled.property.eircode, "T12 X5R2")
        XCTAssertEqual(filled.property.county, .cork, "the county stays as the check had it")
    }

    func testATypedAddressIsNeverOverwritten() {
        var form = HELOCFixtures.form()
        form.property.addressLine1 = "9 Other Road"
        let profile = CoreProfile(
            fullName: "Sean Ryan", brokerID: "b1", brokerName: "Bob", brokerFirm: nil,
            addressLine1: "4 Quay Street", addressLine2: nil, county: "Cork", eircode: "T12 X5R2"
        )

        let filled = form.withHomeAddress(from: profile)

        XCTAssertEqual(filled.property.addressLine1, "9 Other Road")
        XCTAssertEqual(filled.property.eircode, "T12 X5R2", "an empty Eircode is still filled")
    }

    // MARK: - A saved Draft reopens without losing the check's house details

    func testReopeningKeepsTheCheckedHouseAndTakesTheSavedAddress() throws {
        let stored = try HELOCFixtures.storedDraft()

        let filled = stored.filling(HELOCFixtures.form())

        XCTAssertEqual(filled.property.addressLine1, "4 Quay Street")
        XCTAssertEqual(filled.loanAmount, "80,000")
        XCTAssertEqual(filled.property.floorArea, "110", "the HELOC check's house, not the stored one")
        XCTAssertEqual(filled.property.berRating, .b3)
        XCTAssertEqual(filled.property.askingPrice, "")
    }
}

@MainActor
final class HELOCApplicationViewModelTests: XCTestCase {
    private func loaded(_ form: ApplicationForm, stored: StoredApplication) async -> ApplicationViewModel {
        let service = FakeApplicationService()
        service.loadOutcome = .success(stored)
        let model = ApplicationViewModel(form: form, service: service, draftIDs: FakeDraftIDStore(storedID: stored.id))
        await model.loadSavedDraft()
        return model
    }

    // MARK: - One Draft per borrower, of either loan type

    func testTheSavedDraftsLoanTypeIsRead() throws {
        XCTAssertEqual(try HELOCFixtures.storedDraft().loanType, .heloc)
        XCTAssertEqual(try TestFixtures.storedApplication(status: "Draft").loanType, .mortgage)
    }

    func testAMortgageDraftDoesNotFillAHELOCFormAndTheBorrowerIsTold() async throws {
        let model = await loaded(HELOCFixtures.form(), stored: try TestFixtures.storedApplication(status: "Draft"))

        XCTAssertEqual(model.form, HELOCFixtures.form(), "the house being bought must not become their home")
        XCTAssertEqual(model.draftNote, "You have a saved mortgage application. Saving this HELOC replaces it.")
        XCTAssertFalse(model.isReadOnly)
    }

    func testAHELOCDraftDoesNotFillAMortgageFormAndTheBorrowerIsTold() async throws {
        let model = await loaded(TestFixtures.applicationForm(), stored: try HELOCFixtures.storedDraft())

        XCTAssertEqual(model.form, TestFixtures.applicationForm())
        XCTAssertEqual(model.draftNote, "You have a saved HELOC application. Saving this mortgage replaces it.")
    }

    func testADraftOfTheSameTypeFillsTheFormWithNoNote() async throws {
        let model = await loaded(HELOCFixtures.form(), stored: try HELOCFixtures.storedDraft())

        XCTAssertEqual(model.form.loanAmount, "80,000")
        XCTAssertEqual(model.form.property.addressLine1, "4 Quay Street")
        XCTAssertNil(model.draftNote)
    }

    func testASubmittedApplicationOfTheOtherTypeBlocksTheFormWithoutFillingIt() async throws {
        let model = await loaded(HELOCFixtures.form(), stored: try TestFixtures.storedApplication(status: "Applied"))

        XCTAssertTrue(model.isReadOnly)
        XCTAssertEqual(model.form, HELOCFixtures.form())
        XCTAssertEqual(model.draftNote, "You already have a mortgage application in progress, so you can't start a HELOC.")
    }

    func testADraftWithNoLoanTypeIsTreatedAsTheSameType() async throws {
        let json = #"{"id": "app9", "status": "Draft", "loan_amount_eur": 70000.0}"#
        let legacy = try JSONDecoder().decode(StoredApplication.self, from: Data(json.utf8))

        let model = await loaded(HELOCFixtures.form(), stored: legacy)

        XCTAssertEqual(model.form.loanAmount, "70,000")
        XCTAssertNil(model.draftNote)
    }

    func testTheSummarySaysWhatTheHELOCCheckWasFor() {
        let model = ApplicationViewModel(form: HELOCFixtures.form(), service: FakeApplicationService(), draftIDs: FakeDraftIDStore())

        XCTAssertEqual(model.checkSummaryTitle, "From your HELOC check")
        XCTAssertEqual(model.affordabilitySummary, "Cork · 110 m² · €150,000 left on your mortgage · €70,000 income")
    }

    func testAMortgageSummaryIsUnchanged() {
        let model = ApplicationViewModel(form: TestFixtures.applicationForm(), service: FakeApplicationService(), draftIDs: FakeDraftIDStore())

        XCTAssertEqual(model.checkSummaryTitle, "From your affordability check")
    }
}
