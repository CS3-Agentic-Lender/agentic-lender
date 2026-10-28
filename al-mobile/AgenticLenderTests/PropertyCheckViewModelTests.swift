import XCTest
@testable import AgenticLender

/// Answers the property check like the endpoint would, and records what it was sent.
final class FakeValuationService: ValuationService, @unchecked Sendable {
    var result: Result<ValuationResult, APIError> = .success(try! ValuationResult.decode(ValuationRequestTests.referenceResponse))
    private(set) var requests: [ValuationRequest] = []
    private var gate: CheckedContinuation<Void, Never>?
    var holdsAnswer = false

    func value(_ request: ValuationRequest) async throws -> ValuationResult {
        requests.append(request)
        if holdsAnswer { await withCheckedContinuation { gate = $0 } }
        return try result.get()
    }

    func release() {
        gate?.resume()
        gate = nil
    }
}

/// When the property check shows its errors, its bedrooms stepper and Check value (AL-143, Figma 10 to 10d).
@MainActor
final class PropertyCheckViewModelTests: XCTestCase {
    private func filledModel(service: FakeValuationService = FakeValuationService()) -> PropertyCheckViewModel {
        let model = PropertyCheckViewModel(service: service)
        model.form = ValuationRequestTests.form()
        return model
    }

    // MARK: - Errors

    func testNoErrorShowsBeforeAFieldIsLeft() {
        let model = PropertyCheckViewModel(service: FakeValuationService())

        XCTAssertNil(model.visibleError(for: .county))
    }

    func testAnErrorShowsUnderItsFieldOnceItIsLeft() {
        let model = PropertyCheckViewModel(service: FakeValuationService())

        model.markTouched(.floorArea)

        XCTAssertEqual(model.visibleError(for: .floorArea), "Enter the size in m²")
        XCTAssertNil(model.visibleError(for: .county))
    }

    func testTheHintGivesTheFirstProblemInScreenOrder() {
        let model = PropertyCheckViewModel(service: FakeValuationService())

        XCTAssertEqual(model.checkHint, "Choose a county")
        XCTAssertFalse(model.canCheck)

        model.form = ValuationRequestTests.form()

        XCTAssertNil(model.checkHint)
        XCTAssertTrue(model.canCheck)
    }

    func testNumbersAreRegroupedWhileTyping() {
        let model = PropertyCheckViewModel(service: FakeValuationService())

        model.updateText(.floorArea, to: "1200")
        model.updateText(.askingPrice, to: "379000")

        XCTAssertEqual(model.form.floorArea, "1,200")
        XCTAssertEqual(model.form.askingPrice, "379,000")
    }

    // MARK: - Bedrooms

    func testBedroomsStayFromZeroToThirty() {
        let model = PropertyCheckViewModel(service: FakeValuationService())
        model.form.bedrooms = 1

        model.decreaseBedrooms()
        model.decreaseBedrooms()
        XCTAssertEqual(model.form.bedrooms, 0)
        XCTAssertFalse(model.canDecreaseBedrooms)

        model.form.bedrooms = 29
        model.increaseBedrooms()
        model.increaseBedrooms()
        XCTAssertEqual(model.form.bedrooms, 30)
        XCTAssertFalse(model.canIncreaseBedrooms)
    }

    // MARK: - Check value

    func testAnInvalidFormShowsEveryErrorAndSendsNothing() async {
        let service = FakeValuationService()
        let model = PropertyCheckViewModel(service: service)

        await model.check()

        XCTAssertTrue(service.requests.isEmpty)
        XCTAssertEqual(model.visibleError(for: .county), "Choose a county")
        XCTAssertEqual(model.visibleError(for: .eircode), "Enter the Eircode")
    }

    func testAValidFormIsSentAndTheEstimateKept() async {
        let service = FakeValuationService()
        let model = filledModel(service: service)

        await model.check()

        XCTAssertEqual(service.requests.count, 1)
        XCTAssertEqual(service.requests.first?.eircode, "T12 X8Y2")
        XCTAssertEqual(model.result?.displayEstimateEur, 372_000)
        XCTAssertNil(model.checkError)
    }

    /// Figma 10c Valuing: the button shows it's working and a second tap sends nothing.
    func testWhileValuingASecondCheckDoesNothing() async {
        let service = FakeValuationService()
        service.holdsAnswer = true
        let model = filledModel(service: service)

        let first = Task { await model.check() }
        while service.requests.isEmpty { await Task.yield() }
        XCTAssertTrue(model.isValuing)

        await model.check()
        XCTAssertEqual(service.requests.count, 1)

        service.release()
        await first.value
        XCTAssertFalse(model.isValuing)
    }

    /// Figma 10d Couldn't value: the message shows and the same form can be sent again.
    func testAnUnreachableServiceShowsAMessageAndRetryWorks() async {
        let service = FakeValuationService()
        service.result = .failure(.unavailable)
        let model = filledModel(service: service)

        await model.check()

        XCTAssertEqual(model.checkError, "We couldn't value this property right now. Try again in a moment.")
        XCTAssertNil(model.result)

        service.result = .success(try! ValuationResult.decode(ValuationRequestTests.referenceResponse))
        await model.check()

        XCTAssertNil(model.checkError)
        XCTAssertEqual(model.result?.displayEstimateEur, 372_000)
        XCTAssertEqual(service.requests.count, 2)
    }

    func testEachFailureSaysWhatToDo() async {
        let cases: [(APIError, String)] = [
            (.network, "We couldn't value this property right now. Check your connection and try again."),
            (.signedOut, "You've been signed out. Sign in again to check a property."),
            (.unavailable, "We couldn't value this property right now. Try again in a moment."),
        ]
        for (error, message) in cases {
            let service = FakeValuationService()
            service.result = .failure(error)
            let model = filledModel(service: service)

            await model.check()

            XCTAssertEqual(model.checkError, message, "\(error)")
        }
    }
}
