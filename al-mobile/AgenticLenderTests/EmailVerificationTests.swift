import XCTest
@testable import AgenticLender

/// AL-311: after sign-up Home tells a borrower to verify their email, and lets them resend the link,
/// until Firebase says the email is verified.
@MainActor
final class EmailVerificationTests: XCTestCase {
    private let account = VerificationAccount(email: "alice@test.com", hasPassword: true, isVerified: false)

    // MARK: - Criteria 1 and 2: who sees the banner

    func testAnUnverifiedPasswordAccountSeesTheBanner() async {
        let model = EmailVerificationModel(service: FakeVerificationService(account: account))

        await model.refresh()

        XCTAssertEqual(model.banner, "Check your inbox. We sent a link to verify alice@test.com.")
    }

    func testGoogleOnlyAndVerifiedAccountsSeeNoBanner() async {
        for other in [
            VerificationAccount(email: "gina@gmail.com", hasPassword: false, isVerified: false),
            VerificationAccount(email: "alice@test.com", hasPassword: true, isVerified: true),
        ] {
            let model = EmailVerificationModel(service: FakeVerificationService(account: other))
            await model.refresh()
            XCTAssertNil(model.banner, "\(other)")
        }
    }

    // MARK: - Criterion 3: resend, then a 60-second cooldown

    func testResendSendsTheEmailAndWaits60SecondsBeforeAnotherOne() async {
        let service = FakeVerificationService(account: account)
        let model = EmailVerificationModel(service: service)
        await model.refresh()

        await model.resend()
        XCTAssertEqual(service.emailsSent, 1)
        XCTAssertEqual(model.resendTitle, "Sent. Check your inbox.")
        XCTAssertFalse(model.canResend)

        await model.resend()
        XCTAssertEqual(service.emailsSent, 1, "no second email during the cooldown")

        model.cooldownEnded()
        XCTAssertTrue(model.canResend)
        XCTAssertEqual(model.resendTitle, "Resend email")
        XCTAssertEqual(EmailVerificationModel.cooldownSeconds, 60)
    }

    // MARK: - Criterion 4: a failed resend

    func testAFailedResendSaysSoAndKeepsTheBanner() async {
        let service = FakeVerificationService(account: account)
        service.sendFails = true
        let model = EmailVerificationModel(service: service)
        await model.refresh()

        await model.resend()

        XCTAssertEqual(model.error, "We couldn't send the email. Try again in a moment.")
        XCTAssertNotNil(model.banner)
        XCTAssertTrue(model.canResend)
    }

    // MARK: - Criterion 5: verified, the banner goes

    func testOnceVerifiedTheBannerGoesOnTheNextRefresh() async {
        let service = FakeVerificationService(account: account)
        let model = EmailVerificationModel(service: service)
        await model.refresh()

        service.account = VerificationAccount(email: "alice@test.com", hasPassword: true, isVerified: true)
        await model.refresh()

        XCTAssertNil(model.banner)
        XCTAssertEqual(service.reloads, 2, "each refresh reloads the user from Firebase")
    }
}

@MainActor
final class FakeVerificationService: VerificationService {
    var account: VerificationAccount?
    var sendFails = false
    private(set) var emailsSent = 0
    private(set) var reloads = 0

    init(account: VerificationAccount?) {
        self.account = account
    }

    func reload() async throws -> VerificationAccount? {
        reloads += 1
        return account
    }

    func sendVerificationEmail() async throws {
        if sendFails { throw APIError.network }
        emailsSent += 1
    }
}
