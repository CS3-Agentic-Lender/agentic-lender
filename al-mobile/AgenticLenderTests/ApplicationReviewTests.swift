import XCTest
@testable import AgenticLender

/// "Check your application" (Figma 13 Review): every field the borrower sends, grouped into cards,
/// each card with an Edit link back to its part of the form.
final class ApplicationReviewTests: XCTestCase {
    private func review(_ form: ApplicationForm = TestFixtures.filledApplicationForm()) throws -> ApplicationReview {
        try XCTUnwrap(ApplicationReview(form: form))
    }

    private func rows(_ section: ApplicationReview.Section, in review: ApplicationReview) -> [ApplicationReview.Row] {
        review.cards.first { $0.section == section }?.rows ?? []
    }

    func testShowsTheFourCardsInTheFormsOrder() throws {
        XCTAssertEqual(try review().cards.map(\.section), [.you, .money, .loan, .home])
        XCTAssertEqual(try review().cards.map(\.section.title), ["You", "Your money", "Your loan", "The home"])
    }

    func testYouShowsSingleOrJointAndEmployment() throws {
        var form = TestFixtures.filledApplicationForm()
        form.employment = .selfEmployed
        form.yearsInCurrentJob = 4

        XCTAssertEqual(rows(.you, in: try review(form)), [
            .init(label: "Applying", value: "Single"),
            .init(label: "Employment", value: "Self-employed · 4 years"),
        ])
    }

    func testOneYearInAJobIsSingular() throws {
        var form = TestFixtures.filledApplicationForm()
        form.yearsInCurrentJob = 1

        XCTAssertEqual(rows(.you, in: try review(form)).last?.value, "Employed · 1 year")
    }

    func testYourMoneyShowsTheCheckAndTheFormsAmountsInEuro() throws {
        XCTAssertEqual(rows(.money, in: try review()), [
            .init(label: "Gross yearly income", value: "€60,000"),
            .init(label: "Monthly debts", value: "€0"),
            .init(label: "Deposit", value: "€40,000"),
            .init(label: "First-time buyer", value: "Yes"),
            .init(label: "Monthly take-home pay", value: "€3,650"),
            .init(label: "Monthly living costs", value: "€1,400"),
        ])
    }

    func testYourLoanShowsTheAmountAndTerm() throws {
        XCTAssertEqual(rows(.loan, in: try review()), [
            .init(label: "Loan amount", value: "€210,000"),
            .init(label: "Term", value: "30 years"),
        ])
    }

    func testTheHomeShowsEveryPropertyFieldAsTheBorrowerKnowsIt() throws {
        XCTAssertEqual(rows(.home, in: try review()), [
            .init(label: "Address", value: "12 Model Farm Road"),
            .init(label: "Eircode", value: "T12 X8Y2"),
            .init(label: "County", value: "Cork"),
            .init(label: "Asking price", value: "€380,000"),
            .init(label: "Property type", value: "Semi-detached"),
            .init(label: "Size", value: "98 m²"),
            .init(label: "Bedrooms", value: "3"),
            .init(label: "BER rating", value: "C2"),
        ])
    }

    func testASecondAddressLineJoinsTheFirst() throws {
        var form = TestFixtures.filledApplicationForm()
        form.property.addressLine2 = "Bishopstown"

        XCTAssertEqual(rows(.home, in: try review(form)).first?.value, "12 Model Farm Road, Bishopstown")
    }

    func testAFormWithErrorsHasNoReview() {
        var form = TestFixtures.filledApplicationForm()
        form.loanAmount = ""

        XCTAssertNil(ApplicationReview(form: form))
    }

    func testEachCardsEditOpensItsOwnPartOfTheForm() {
        XCTAssertEqual(ApplicationReview.Section.you.formAnchor, .employment)
        XCTAssertEqual(ApplicationReview.Section.money.formAnchor, .money)
        XCTAssertEqual(ApplicationReview.Section.loan.formAnchor, .loan)
        XCTAssertEqual(ApplicationReview.Section.home.formAnchor, .home)
    }

    func testTheReferenceIsTheFirstEightCharactersOfTheIDInCapitals() {
        XCTAssertEqual(ApplicationReference(applicationID: "7f3k9qx2abCDEfgh1234").text, "7F3K9QX2")
        XCTAssertEqual(ApplicationReference(applicationID: "app42").text, "APP42")
    }
}
