import XCTest
@testable import AgenticLender

/// The fast-track appraisal fee (AL-148, Figma 16 to 18b): the offer on the status screen, the
/// payment intent from al-core, and the flow from Pay to the receipt, which waits for al-core's
/// webhook to mark the fee paid rather than trusting the payment sheet.
@MainActor
final class FeeTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!
    private let paidAt = ISO8601DateFormatter().date(from: "2026-11-25T14:32:00Z")!
    private let intent = FeeIntent(clientSecret: "pi_3xYz_secret_abc", paymentIntentID: "pi_123453xYz", amountEur: 150)

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    // MARK: - The offer on the status screen (Figma 16a, 18a)

    func testAnApplicationAwaitingTheUnderwriterIsOfferedFastTrack() {
        XCTAssertEqual(ApplicationFee(fields: [:]).section(for: .applied), .offer)
        XCTAssertEqual(ApplicationFee(fields: [:]).section(for: .aiDeliberated), .offer)
    }

    func testNoOfferBeforeSubmittingOrOnceDecided() {
        for status in [ApplicationStatus.draft, .underwriterApproved, .declined, .funded, .closed] {
            XCTAssertNil(ApplicationFee(fields: [:]).section(for: status), "\(status)")
        }
    }

    func testAPaidFeeShowsAsPaidInsteadOfTheOffer() {
        let fee = ApplicationFee(fields: ["feeStatus": "paid", "feePaidAt": paidAt, "feeIntentId": "pi_123453xYz"])

        XCTAssertTrue(fee.isPaid)
        XCTAssertEqual(fee.section(for: .aiDeliberated), .paid(paidAt))
        XCTAssertEqual(fee.section(for: .funded), .paid(paidAt), "a paid fee stays on the screen after the decision")
    }

    func testTheStatusRecordCarriesTheFeeFromTheApplication() throws {
        let record = try XCTUnwrap(ApplicationStatusRecord(fields: ["status": "AI Deliberated", "feeStatus": "paid", "feePaidAt": paidAt]))

        XCTAssertEqual(record.fee.section(for: record.status), .paid(paidAt))
    }

    func testAPendingFeeIsNotPaid() {
        XCTAssertFalse(ApplicationFee(fields: ["feeStatus": "pending"]).isPaid)
    }

    // MARK: - POST /core/applications/{id}/fee-intent

    func testAsksAlCoreForAPaymentIntentForTheApplication() async throws {
        StubURLProtocol.response = (201, #"{"client_secret": "pi_3xYz_secret_abc", "payment_intent_id": "pi_123453xYz", "amount_eur": 150}"#)
        let api = APIFeeService(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "test-token" })

        let result = try await api.createIntent(applicationID: "app-applied")

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/applications/app-applied/fee-intent")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(result, intent)
    }

    // MARK: - Criteria 1 and 2: Pay → the Stripe sheet → confirming → the receipt

    func testPayOpensTheSheetWithAlCoresIntent() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")

        await model.pay()

        XCTAssertEqual(model.state, .sheet(intent))
    }

    func testAfterTheSheetCompletesTheAppWaitsForAlCoreBeforeTheReceipt() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        await model.pay()

        model.sheetFinished(.completed)
        XCTAssertEqual(model.state, .confirming(stillWaiting: false))

        model.feeChanged(ApplicationFee(fields: ["feeStatus": "pending"]))
        XCTAssertEqual(model.state, .confirming(stillWaiting: false), "only the webhook's paid counts")

        model.feeChanged(ApplicationFee(fields: ["feeStatus": "paid", "feePaidAt": paidAt]))
        XCTAssertEqual(model.state, .receipt(FeeReceipt(amountEur: 150, paidAt: paidAt, paymentIntentID: "pi_123453xYz")))
    }

    func testAfter20SecondsItSaysItsStillWaiting() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        await model.pay()
        model.sheetFinished(.completed)

        model.waitedTooLong()

        XCTAssertEqual(model.state, .confirming(stillWaiting: true))
        XCTAssertEqual(FeeViewModel.confirmingSeconds, 20)
    }

    func testClosingTheSheetGoesBackToTheFeeScreen() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        await model.pay()

        model.sheetFinished(.canceled)

        XCTAssertEqual(model.state, .ready)
    }

    // MARK: - A payment al-core already has (409)

    func testA409FromTheFeeIntentIsAConflict() async {
        StubURLProtocol.response = (409, #"{"error": {"code": "CONFLICT", "message": "The payment went through and is being confirmed"}}"#)
        let api = APIFeeService(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "test-token" })

        do {
            _ = try await api.createIntent(applicationID: "app-applied")
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? APIError, .conflict)
        }
    }

    func testWhenAlCoreAlreadyHasThePaymentTheAppWaitsInsteadOfSayingNothingWasCharged() async {
        // The sheet took the payment, the app was closed before the webhook, and Pay is tapped again.
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.conflict)), publishableKey: "pk_test_x")

        await model.pay()

        XCTAssertEqual(model.state, .confirming(stillWaiting: false))
    }

    func testTheReceiptStillShowsWhenThisVisitNeverGotAnIntent() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.conflict)), publishableKey: "pk_test_x")
        await model.pay()

        model.feeChanged(ApplicationFee(fields: ["feeStatus": "paid", "feePaidAt": paidAt, "feeIntentId": "pi_123453xYz"]))

        XCTAssertEqual(model.state, .receipt(FeeReceipt(amountEur: 150, paidAt: paidAt, paymentIntentID: "pi_123453xYz")))
    }

    func testA409WhenTheWebhookAlreadyLandedShowsTheReceiptStraightAway() async {
        // Nic's review on #242: the webhook marks the fee paid while the offer is open, then Pay is tapped. The
        // fee doesn't change again, so nothing would end "Confirming"; the fee the screen already has does.
        let paid = ApplicationFee(fields: ["feeStatus": "paid", "feePaidAt": paidAt, "feeIntentId": "pi_123453xYz"])
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.conflict)), publishableKey: "pk_test_x")

        await model.pay(currentFee: paid)

        XCTAssertEqual(model.state, .receipt(FeeReceipt(amountEur: 150, paidAt: paidAt, paymentIntentID: "pi_123453xYz")))
    }

    // MARK: - The underwriter decided first (al-core's 409 for a decided application)

    func testA409AfterTheUnderwriterDecidedSaysFastTrackNoLongerApplies() async {
        // al-core also answers 409 for a decided application, and no webhook will follow that.
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.conflict)), publishableKey: "pk_test_x")
        await model.pay()

        model.offerChanged(nil)

        XCTAssertEqual(model.state, .decided)
        XCTAssertEqual(FeeViewModel.decidedMessage, "Your application has already been decided, so fast-track no longer applies. Nothing was charged.")
    }

    func testA409WhenTheDecisionIsAlreadyKnownSaysSoStraightAway() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.conflict)), publishableKey: "pk_test_x")
        model.offerChanged(.offer)
        model.offerChanged(nil)

        await model.pay()

        XCTAssertEqual(model.state, .decided)
    }

    func testADecisionWhileTheOfferIsShownEndsTheOffer() {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        model.offerChanged(.offer)

        model.offerChanged(nil)

        XCTAssertEqual(model.state, .decided)
    }

    func testADecisionAfterStripeTookThePaymentKeepsWaitingForTheWebhook() async {
        // The webhook marks a payment that went through paid whatever the status, so the receipt still comes.
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        await model.pay()
        model.sheetFinished(.completed)

        model.offerChanged(nil)

        XCTAssertEqual(model.state, .confirming(stillWaiting: false))
    }

    func testAnEarlierPaymentTheWebhookMarksPaidReplacesTheDecidedMessageWithTheReceipt() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.conflict)), publishableKey: "pk_test_x")
        await model.pay()
        model.offerChanged(nil)

        model.feeChanged(ApplicationFee(fields: ["feeStatus": "paid", "feePaidAt": paidAt, "feeIntentId": "pi_123453xYz"]))

        XCTAssertEqual(model.state, .receipt(FeeReceipt(amountEur: 150, paidAt: paidAt, paymentIntentID: "pi_123453xYz")))
    }

    // MARK: - Figma 16b: the payment couldn't start, nothing was charged

    func testAnIntentThatFailsSaysNothingWasCharged() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .failure(.unavailable)), publishableKey: "pk_test_x")

        await model.pay()

        XCTAssertEqual(model.state, .failed("We couldn't start the payment. Nothing was charged. Try again."))
    }

    func testWithoutAPublishableKeyThePaymentCantStart() async {
        let service = FakeFeeService(result: .success(intent))
        let model = FeeViewModel(applicationID: "app-applied", service: service, publishableKey: " ")

        await model.pay()

        XCTAssertEqual(model.state, .failed(FeeViewModel.couldNotStart))
        XCTAssertEqual(service.calls, 0, "no intent is created that can't be paid")
    }

    func testTheSheetFailingSaysNothingWasChargedToo() async {
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        await model.pay()

        model.sheetFinished(.failed(reason: "This PaymentIntent's status is succeeded"))

        XCTAssertEqual(model.state, .failed(FeeViewModel.couldNotStart))
    }

    func testTheSheetsOwnReasonIsKeptForTheLog() async {
        // On 18 Nov the sheet refused an intent that was already paid, and the app said only "couldn't start".
        let model = FeeViewModel(applicationID: "app-applied", service: FakeFeeService(result: .success(intent)), publishableKey: "pk_test_x")
        await model.pay()

        model.sheetFinished(.failed(reason: "This PaymentIntent's status is succeeded"))

        XCTAssertEqual(model.lastSheetFailure, "This PaymentIntent's status is succeeded")
    }

    // MARK: - The receipt (Figma 18)

    func testTheReceiptShowsAShortPaymentReference() {
        let receipt = FeeReceipt(amountEur: 150, paidAt: paidAt, paymentIntentID: "pi_3MtwBwLkdIwHu7ix28a3tqPa")

        XCTAssertEqual(receipt.shortReference, "pi_…tqPa")
        XCTAssertEqual(receipt.amountText, "€150.00")
    }

    // MARK: - The publishable key (Nic's review on #242): from Info.plist, so it holds outside Xcode too

    func testTheKeyIsReadFromTheAppsInfoPlist() {
        // Config/AppInfo.plist passes AL_STRIPE_PUBLISHABLE_KEY (gitignored Config/Hosted.xcconfig) in.
        XCTAssertEqual(BackendConfig(environment: [:], info: ["ALStripePublishableKey": " pk_test_abc "]).stripePublishableKey, "pk_test_abc")
    }

    func testABlankKeyMeansNoKey() {
        XCTAssertNil(BackendConfig(environment: [:], info: ["ALStripePublishableKey": ""]).stripePublishableKey)
        XCTAssertNil(BackendConfig(environment: [:], info: [:]).stripePublishableKey)
    }

    func testOnlyAPublishableTestKeyIsAccepted() {
        // A live key, or a secret key put in by mistake, never reaches Stripe's SDK.
        for key in ["pk_live_abc", "sk_test_abc", "rk_test_abc"] {
            XCTAssertNil(BackendConfig(environment: [:], info: ["ALStripePublishableKey": key]).stripePublishableKey, key)
        }
    }

    func testTheSchemesEnvironmentNoLongerSetsTheKey() {
        XCTAssertNil(BackendConfig(environment: ["STRIPE_PUBLISHABLE_KEY": "pk_test_abc"], info: [:]).stripePublishableKey)
    }
}

/// Answers every intent request with a fixed result and counts the calls.
@MainActor
final class FakeFeeService: FeeService {
    let result: Result<FeeIntent, APIError>
    private(set) var calls = 0

    init(result: Result<FeeIntent, APIError>) {
        self.result = result
    }

    func createIntent(applicationID: String) async throws -> FeeIntent {
        calls += 1
        return try result.get()
    }
}
