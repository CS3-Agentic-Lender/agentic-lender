import XCTest
@testable import AgenticLender

@MainActor
final class AffordabilityViewModelTests: XCTestCase {
    private func fill(_ model: AffordabilityViewModel) {
        model.form.income = "60,000"
        model.form.monthlyDebts = "250"
        model.form.deposit = "30,000"
    }

    func testCalculateIsDisabledUntilTheFormIsValid() {
        let model = makeModel()
        XCTAssertFalse(model.canCalculate)

        fill(model)

        XCTAssertTrue(model.canCalculate)
    }

    func testADisabledCalculateSaysWhatIsMissingFirst() {
        let model = makeModel()
        fill(model)
        model.form.applicants = .joint

        XCTAssertFalse(model.canCalculate)
        XCTAssertEqual(model.calculateHint, "Enter the second applicant's gross yearly income")
    }

    func testNoHintOnceCalculateIsAllowed() {
        let model = makeModel()
        fill(model)

        XCTAssertNil(model.calculateHint)
    }

    func testNoErrorsShowBeforeAFieldIsLeft() {
        let model = makeModel()

        XCTAssertNil(model.visibleError(for: .income))
    }

    func testErrorShowsOnceTheFieldIsLeft() {
        let model = makeModel()
        model.form.income = "12,000,000"

        model.markTouched(.income)

        XCTAssertEqual(model.visibleError(for: .income), "Enter an amount up to €10,000,000")
    }

    func testTypingRegroupsTheAmount() {
        let model = makeModel()

        model.updateAmount(.income, to: "60000")

        XCTAssertEqual(model.form.income, "60,000")
    }

    func testTermStepsByOneYearWithinFiveToThirtyFive() {
        let model = makeModel()

        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 31)

        model.form.termYears = 35
        model.increaseTerm()
        XCTAssertEqual(model.form.termYears, 35)
        XCTAssertFalse(model.canIncreaseTerm)

        model.form.termYears = 5
        model.decreaseTerm()
        XCTAssertEqual(model.form.termYears, 5)
        XCTAssertFalse(model.canDecreaseTerm)
    }

    func testSwitchingToJointNeedsTheSecondIncomeBeforeCalculating() {
        let model = makeModel()
        fill(model)

        model.form.applicants = .joint
        XCTAssertFalse(model.canCalculate)

        model.updateAmount(.secondIncome, to: "45000")
        XCTAssertTrue(model.canCalculate)
    }

    func testCalculateSendsTheRequestAndShowsTheResult() async throws {
        let service = FakeAffordabilityService()
        let model = makeModel(service)
        fill(model)

        await model.calculate()

        XCTAssertEqual(service.requests.first?.grossIncome, 60_000)
        let outcome = try XCTUnwrap(model.outcome)
        XCTAssertEqual(outcome.result.maxLoanEur, 240_000)
        XCTAssertEqual(outcome.summary.limit, "Limited by income (4× income)")
        XCTAssertFalse(model.isCalculating)
        XCTAssertNil(model.calculationError)
    }

    func testCalculateWithErrorsShowsThemAndSendsNothing() async {
        let service = FakeAffordabilityService()
        let model = makeModel(service)

        await model.calculate()

        XCTAssertTrue(service.requests.isEmpty)
        XCTAssertNil(model.outcome)
        XCTAssertEqual(model.visibleError(for: .deposit), "Enter your deposit, or 0 if you have none")
    }

    func testNoConnectionShowsTheCouldNotCalculateMessage() async {
        let service = FakeAffordabilityService()
        service.result = .failure(.network)
        let model = makeModel(service)
        fill(model)

        await model.calculate()

        XCTAssertNil(model.outcome)
        XCTAssertEqual(model.calculationError, "We couldn't calculate right now. Check your connection and try again.")
    }

    func testTryingAgainClearsTheMessage() async {
        let service = FakeAffordabilityService()
        service.result = .failure(.unavailable)
        let model = makeModel(service)
        fill(model)
        await model.calculate()
        XCTAssertNotNil(model.calculationError)

        service.result = .success(FakeAffordabilityService.referenceCaseOne)
        await model.calculate()

        XCTAssertNil(model.calculationError)
        XCTAssertNotNil(model.outcome)
    }

    func testShowsCalculatingWhileTheEndpointIsAnswering() async {
        let service = HeldAffordabilityService()
        let model = AffordabilityViewModel(service: service)
        fill(model)

        let first = Task { await model.calculate() }
        await service.waitForRequest()
        XCTAssertTrue(model.isCalculating)

        service.answer(FakeAffordabilityService.referenceCaseOne)
        await first.value

        XCTAssertFalse(model.isCalculating)
        XCTAssertEqual(model.outcome?.result.maxLoanEur, 240_000)
    }

    func testASecondCalculateWhileOneIsRunningSendsNothing() async {
        let service = HeldAffordabilityService()
        let model = AffordabilityViewModel(service: service)
        fill(model)

        let first = Task { await model.calculate() }
        await service.waitForRequest()
        service.answerLaterRequestsWith(FakeAffordabilityService.referenceCaseOne)
        await model.calculate()
        service.answer(FakeAffordabilityService.referenceCaseOne)
        await first.value

        XCTAssertEqual(service.requests.count, 1)
        XCTAssertFalse(model.isCalculating)
    }

    func testAFailedCalculationClearsTheEarlierResult() async {
        let service = FakeAffordabilityService()
        let model = makeModel(service)
        fill(model)
        await model.calculate()
        XCTAssertNotNil(model.outcome)

        service.result = .failure(.network)
        await model.calculate()

        XCTAssertNil(model.outcome)
        XCTAssertNotNil(model.calculationError)
        XCTAssertEqual(model.form.income, "60,000")
    }

    private func makeModel(_ service: FakeAffordabilityService = FakeAffordabilityService()) -> AffordabilityViewModel {
        AffordabilityViewModel(service: service)
    }
}

/// Holds each request until the test answers it, so a test can look at the model mid-calculation.
@MainActor
final class HeldAffordabilityService: AffordabilityService, @unchecked Sendable {
    private(set) var requests: [AffordabilityRequest] = []
    private var pending: [CheckedContinuation<AffordabilityResult, Error>] = []
    private var requestArrived: CheckedContinuation<Void, Never>?
    private var immediateAnswer: AffordabilityResult?

    nonisolated func calculate(_ request: AffordabilityRequest) async throws -> AffordabilityResult {
        try await hold(request)
    }

    /// Returns once a request is waiting for an answer.
    func waitForRequest() async {
        guard pending.isEmpty else { return }
        await withCheckedContinuation { requestArrived = $0 }
    }

    /// Answers every waiting request, so no test hangs on one it didn't expect.
    func answer(_ result: AffordabilityResult) {
        let waiting = pending
        pending = []
        waiting.forEach { $0.resume(returning: result) }
    }

    /// From now on, new requests are answered straight away instead of held.
    func answerLaterRequestsWith(_ result: AffordabilityResult) {
        immediateAnswer = result
    }

    private func hold(_ request: AffordabilityRequest) async throws -> AffordabilityResult {
        requests.append(request)
        if let immediateAnswer { return immediateAnswer }
        return try await withCheckedThrowingContinuation { continuation in
            pending.append(continuation)
            requestArrived?.resume()
            requestArrived = nil
        }
    }
}

/// Records affordability requests instead of calling the endpoint.
final class FakeAffordabilityService: AffordabilityService, @unchecked Sendable {
    static let referenceCaseOne = AffordabilityResult(
        maxLoanEur: 240_000, maxPropertyPriceEur: 280_000, monthlyRepaymentEur: 1145.80,
        stressedRepaymentEur: 1438.92, limitedBy: .income, benchmarkRatePct: 4.0,
        stressedRatePct: 6.0, rateDate: "2026-08"
    )

    var result: Result<AffordabilityResult, AffordabilityError> = .success(referenceCaseOne)
    private(set) var requests: [AffordabilityRequest] = []

    func calculate(_ request: AffordabilityRequest) async throws -> AffordabilityResult {
        requests.append(request)
        return try result.get()
    }
}
