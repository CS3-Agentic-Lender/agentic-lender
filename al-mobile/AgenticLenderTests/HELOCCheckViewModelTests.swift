import XCTest
@testable import AgenticLender

/// Answers the HELOC check like the endpoint would, and records what it was sent.
final class FakeHELOCService: HELOCService, @unchecked Sendable {
    var result: Result<HELOCResult, AffordabilityError> = .success(try! HELOCResult.decode(HELOCRequestTests.referenceResponse))
    private(set) var requests: [HELOCRequest] = []
    /// When set, the call waits here until the test opens the gate.
    var gate: CallGate?

    func checkHELOC(_ request: HELOCRequest) async throws -> HELOCResult {
        requests.append(request)
        if let gate { await gate.pass() }
        return try result.get()
    }
}

/// When the HELOC check form shows its errors, its two steppers, and Calculate (AL-207).
@MainActor
final class HELOCCheckViewModelTests: XCTestCase {
    func testNoErrorShowsBeforeAFieldIsLeft() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())

        XCTAssertNil(model.visibleError(for: .mortgageBalance))
    }

    func testAnErrorShowsOnceItsFieldIsLeft() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())

        model.markTouched(.mortgageBalance)

        XCTAssertEqual(model.visibleError(for: .mortgageBalance), "Enter what's left on your mortgage, or 0 if it's paid off")
        XCTAssertNil(model.visibleError(for: .income))
    }

    func testAmountsAreRegroupedWhileTyping() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())

        model.updateText(.mortgageBalance, to: "150000")
        model.updateText(.income, to: "70000")
        model.updateText(.monthlyDebts, to: "300")
        model.updateText(.floorArea, to: "1200")

        XCTAssertEqual(model.form.mortgageBalance, "150,000")
        XCTAssertEqual(model.form.income, "70,000")
        XCTAssertEqual(model.form.monthlyDebts, "300")
        XCTAssertEqual(model.form.floorArea, "1,200")
    }

    func testIsCompleteOnlyWhenEveryFieldIsValid() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())
        XCTAssertFalse(model.isComplete)

        model.form = HELOCCheckForm(
            county: .cork, propertyType: .semiDetached, floorArea: "110", bedrooms: 3, berRating: .b3,
            mortgageBalance: "150,000", income: "70,000", monthlyDebts: "300", termYears: 20
        )

        XCTAssertTrue(model.isComplete)
    }

    // MARK: - Bedrooms

    func testBedroomsGoDownToZeroAndNoFurther() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())
        model.form.bedrooms = 1

        model.decreaseBedrooms()
        XCTAssertEqual(model.form.bedrooms, 0)
        XCTAssertFalse(model.canDecreaseBedrooms)

        model.decreaseBedrooms()
        XCTAssertEqual(model.form.bedrooms, 0)
    }

    func testBedroomsGoUp() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())

        model.increaseBedrooms()

        XCTAssertEqual(model.form.bedrooms, 4)
    }

    // MARK: - Term

    func testTermStaysWithinFiveToThirtyFiveYears() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())

        model.form.termYears = 35
        XCTAssertFalse(model.canIncreaseTerm)
        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 35)

        model.form.termYears = 5
        XCTAssertFalse(model.canDecreaseTerm)
        model.decreaseTerm()
        XCTAssertEqual(model.form.termYears, 5)
    }

    // MARK: - Calculate

    func testCalculateIsOffUntilTheFormIsValid() {
        let model = HELOCCheckViewModel(service: FakeHELOCService())
        XCTAssertFalse(model.canCalculate)

        model.form = HELOCRequestTests.referenceForm

        XCTAssertTrue(model.canCalculate)
    }

    func testCalculateSendsTheFormAndShowsTheAnswer() async throws {
        let service = FakeHELOCService()
        let model = HELOCCheckViewModel(service: service)
        model.form = HELOCRequestTests.referenceForm

        await model.calculate()

        XCTAssertEqual(service.requests, [HELOCRequest(form: HELOCRequestTests.referenceForm)])
        XCTAssertEqual(model.result?.maxLineEur, 59_882.97)
        XCTAssertNil(model.calculationError)
        XCTAssertFalse(model.isCalculating)
    }

    func testTheAnswerKeepsTheCheckItCameFromForStartApplication() async throws {
        let model = HELOCCheckViewModel(service: FakeHELOCService())
        model.form = HELOCRequestTests.referenceForm

        await model.calculate()

        let start = try XCTUnwrap(model.applicationForm())
        XCTAssertEqual(start.loanType, .heloc)
        XCTAssertEqual(start.maxLoanEur, 59_882.97)
        XCTAssertEqual(start.property.county, HELOCRequestTests.referenceForm.county)
    }

    func testThereIsNoApplicationToStartWithoutAnAnswer() {
        XCTAssertNil(HELOCCheckViewModel(service: FakeHELOCService()).applicationForm())
    }

    func testANoEquityAnswerIsStillAResult() async throws {
        let service = FakeHELOCService()
        service.result = .success(try HELOCResult.decode(HELOCRequestTests.noEquityResponse))
        let model = HELOCCheckViewModel(service: service)
        model.form = HELOCRequestTests.referenceForm

        await model.calculate()

        XCTAssertEqual(model.result?.hasEquity, false)
    }

    func testAnInvalidFormShowsEveryErrorAndSendsNothing() async {
        let service = FakeHELOCService()
        let model = HELOCCheckViewModel(service: service)

        await model.calculate()

        XCTAssertTrue(service.requests.isEmpty)
        XCTAssertEqual(model.visibleError(for: .county), "Choose the county")
        XCTAssertEqual(model.visibleError(for: .propertyType), "Choose the property type")
        XCTAssertNil(model.result)
    }

    func testAFailedCalculationSaysWhyAndDropsTheOldAnswer() async {
        let service = FakeHELOCService()
        let model = HELOCCheckViewModel(service: service)
        model.form = HELOCRequestTests.referenceForm
        await model.calculate()

        service.result = .failure(.network)
        await model.calculate()

        XCTAssertNil(model.result)
        XCTAssertEqual(model.calculationError, AffordabilityError.network.message)
    }

    func testOnlyOneCalculationRunsAtATime() async {
        let service = FakeHELOCService()
        let gate = CallGate()
        service.gate = gate
        let model = HELOCCheckViewModel(service: service)
        model.form = HELOCRequestTests.referenceForm

        let first = Task { await model.calculate() }
        await gate.waitForCall()
        XCTAssertTrue(model.isCalculating)
        await model.calculate()
        gate.open()
        await first.value

        XCTAssertEqual(service.requests.count, 1)
    }
}
