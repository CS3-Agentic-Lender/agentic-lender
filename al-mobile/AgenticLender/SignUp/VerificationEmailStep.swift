/// Sign-up's last step: a link to verify the borrower's email (AL-249).
///
/// Firebase lets a trusted provider take over an account whose email isn't verified, so without
/// this a later Continue with Google with the same email replaces the borrower's password. Once the
/// link is opened, Google is linked to the account instead and the password keeps working.
///
/// The login and profile already exist by now, so a failed request is only logged.
struct VerificationEmailStep {
    let send: () async throws -> Void
    let logFailure: (Error) -> Void

    func run() async {
        do {
            try await send()
        } catch {
            logFailure(error)
        }
    }
}
