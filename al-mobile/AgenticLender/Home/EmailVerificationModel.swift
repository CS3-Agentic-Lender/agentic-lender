import FirebaseAuth
import Observation
import os

/// The signed-in account as far as email verification goes (AL-311).
struct VerificationAccount: Equatable, Sendable {
    let email: String
    /// Signed up with email and password. Google-only accounts are verified by Google.
    let hasPassword: Bool
    let isVerified: Bool
}

@MainActor
protocol VerificationService {
    /// Reloads the signed-in user from Firebase, so a link opened in Mail counts straight away.
    func reload() async throws -> VerificationAccount?
    func sendVerificationEmail() async throws
}

/// Home's "Check your inbox" banner (AL-311): shown until a password account's email is verified, so a
/// later Continue with Google links to the account instead of replacing the password. Resend waits
/// 60 seconds between emails so Firebase's rate limit isn't hit.
@MainActor
@Observable
final class EmailVerificationModel {
    static let cooldownSeconds: Double = 60
    static let failedMessage = "We couldn't send the email. Try again in a moment."

    private(set) var account: VerificationAccount?
    private(set) var isCoolingDown = false
    private(set) var error: String?

    private let service: VerificationService
    /// Waits the given number of seconds; throws when Home goes away first. Replaced in tests.
    private let sleep: (Double) async throws -> Void
    private let logger = Logger(category: "Verification")

    init(service: VerificationService, sleep: @escaping (Double) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }) {
        self.service = service
        self.sleep = sleep
    }

    /// "Check your inbox. We sent a link to verify alice@test.com.", or nil when nothing needs verifying.
    var banner: String? {
        guard let account, account.hasPassword, !account.isVerified else { return nil }
        return "Check your inbox. We sent a link to verify \(account.email)."
    }

    var canResend: Bool { !isCoolingDown }
    var resendTitle: String { isCoolingDown ? "Sent. Check your inbox." : "Resend email" }

    /// When Home opens and when the app comes back to the foreground.
    func refresh() async {
        do {
            account = try await service.reload()
        } catch {
            logger.error("Reloading the user failed: \(String(describing: error), privacy: .public)")
        }
    }

    func resend() async {
        guard canResend else { return }
        error = nil
        do {
            try await service.sendVerificationEmail()
            isCoolingDown = true
        } catch {
            logger.error("Resending the verification email failed: \(String(describing: error), privacy: .public)")
            self.error = Self.failedMessage
        }
    }

    func cooldownEnded() {
        isCoolingDown = false
    }

    /// After a resend, waits 60 seconds and lets Resend work again. If Home goes away first the wait is
    /// cancelled and the button stays disabled; Home starts the wait again when it comes back.
    func waitOutCooldown() async {
        guard isCoolingDown else { return }
        do {
            try await sleep(Self.cooldownSeconds)
            cooldownEnded()
        } catch {
            return
        }
    }
}

/// Firebase's signed-in user: whether it has a password provider and a verified email.
struct FirebaseVerificationService: VerificationService {
    func reload() async throws -> VerificationAccount? {
        guard let user = Auth.auth().currentUser else { return nil }
        try await user.reload()
        guard let email = user.email else { return nil }
        let hasPassword = user.providerData.contains { $0.providerID == EmailAuthProviderID }
        return VerificationAccount(email: email, hasPassword: hasPassword, isVerified: user.isEmailVerified)
    }

    func sendVerificationEmail() async throws {
        guard let user = Auth.auth().currentUser else { throw APIError.signedOut }
        try await user.sendEmailVerification()
    }
}
