import XCTest
@testable import AgenticLender

@MainActor
final class BrokerPickerViewModelTests: XCTestCase {
    private func picker(
        _ service: FakeProfileService? = nil,
        mode: BrokerPickerViewModel.Mode = .choose
    ) -> BrokerPickerViewModel {
        BrokerPickerViewModel(mode: mode, service: service ?? FakeProfileService())
    }

    // MARK: - Loading the list

    func testListsTheBrokersByNameAndFirm() async {
        let model = picker()

        await model.load()

        XCTAssertEqual(model.state, .loaded([.bob, .ciara]))
    }

    func testIsLoadingUntilTheListArrives() {
        XCTAssertEqual(picker().state, .loading)
    }

    func testNoBrokersShowsTheEmptyMessage() async {
        let service = FakeProfileService()
        service.brokersResult = .success([])
        let model = picker(service)

        await model.load()

        XCTAssertEqual(model.state, .failed(BrokerPickerViewModel.noBrokersMessage))
    }

    func testABrokerWithoutANameIsLeftOut() async {
        let service = FakeProfileService()
        service.brokersResult = .success([Broker(uid: "broker9", name: nil, firm: "Ghost Ltd"), .bob])
        let model = picker(service)

        await model.load()

        XCTAssertEqual(model.state, .loaded([.bob]))
    }

    func testAListThatCantLoadSaysWhyAndRetryLoadsAgain() async {
        let service = FakeProfileService()
        service.brokersResult = .failure(.network)
        let model = picker(service)

        await model.load()
        XCTAssertEqual(model.state, .failed(CommonMessage.cantReachServer))

        service.brokersResult = .failure(.unknown)
        await model.load()
        XCTAssertEqual(model.state, .failed(BrokerPickerViewModel.listFailedMessage))

        service.brokersResult = .success([.bob])
        await model.load()
        XCTAssertEqual(model.state, .loaded([.bob]))
        XCTAssertEqual(service.brokerLoads, 3)
    }

    // MARK: - Choosing

    func testContinueNeedsABrokerSelected() async {
        let model = picker()
        await model.load()

        XCTAssertFalse(model.canSave)
        model.select(.ciara)
        XCTAssertTrue(model.canSave)
        XCTAssertEqual(model.selectedID, "broker2")
    }

    func testSavingSendsTheChoiceAndReturnsTheUpdatedProfile() async {
        let service = FakeProfileService()
        let model = picker(service)
        await model.load()
        model.select(.bob)

        let saved = await model.save()

        XCTAssertEqual(service.chosenBrokerIDs, ["broker1"])
        XCTAssertEqual(saved?.brokerName, "Bob Murphy")
        XCTAssertNil(model.saveError)
        XCTAssertFalse(model.isSaving)
    }

    func testAFailedSaveKeepsTheChoiceAndShowsAnError() async {
        for (failure, message) in [
            (AccountError.network, CommonMessage.cantReachServer),
            (.unknown, BrokerPickerViewModel.saveFailedMessage),
        ] {
            let service = FakeProfileService()
            service.chooseResult = .failure(failure)
            let model = picker(service)
            await model.load()
            model.select(.ciara)

            let saved = await model.save()

            XCTAssertNil(saved, "\(failure)")
            XCTAssertEqual(model.saveError, message, "\(failure)")
            XCTAssertEqual(model.selectedID, "broker2", "\(failure)")
            XCTAssertTrue(model.canSave, "\(failure)")
        }
    }

    func testSavingAgainAfterAFailureClearsTheError() async {
        let service = FakeProfileService()
        service.chooseResult = .failure(.network)
        let model = picker(service)
        await model.load()
        model.select(.bob)
        _ = await model.save()

        service.chooseResult = nil
        let saved = await model.save()

        XCTAssertEqual(saved?.brokerID, "broker1")
        XCTAssertNil(model.saveError)
        XCTAssertEqual(service.chosenBrokerIDs, ["broker1", "broker1"])
    }

    func testNothingIsSentWithoutASelection() async {
        let service = FakeProfileService()
        let model = picker(service)
        await model.load()

        let saved = await model.save()

        XCTAssertNil(saved)
        XCTAssertTrue(service.chosenBrokerIDs.isEmpty)
    }

    // MARK: - Choose versus change

    func testChoosingAfterSignUpSaysContinue() {
        let model = picker(mode: .choose)

        XCTAssertEqual(model.title, "Choose your broker")
        XCTAssertEqual(model.buttonTitle, "Continue")
        XCTAssertNil(model.existingApplicationsNote)
    }

    func testChangingStartsOnTheCurrentBrokerAndSaysSave() async {
        let model = picker(mode: .change(current: .aliceWithBob))
        await model.load()

        XCTAssertEqual(model.title, "Change broker")
        XCTAssertEqual(model.buttonTitle, "Save")
        XCTAssertEqual(model.selectedID, "broker1")
        XCTAssertEqual(model.existingApplicationsNote, "Applications you've already started stay with Bob Murphy.")
    }

    func testSaveStaysOffUntilADifferentBrokerIsPicked() async {
        let model = picker(mode: .change(current: .aliceWithBob))
        await model.load()

        XCTAssertFalse(model.canSave)
        model.select(.ciara)
        XCTAssertTrue(model.canSave)
        model.select(.bob)
        XCTAssertFalse(model.canSave)
    }
}
