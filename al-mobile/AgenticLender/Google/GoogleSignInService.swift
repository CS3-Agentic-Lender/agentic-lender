/// The tokens a Google sign-in hands to Firebase Auth.
struct GoogleToken: Equatable, Sendable {
    let idToken: String
    let accessToken: String
}

/// Who signed in with Google, for the profile screen of a first-time user.
struct GoogleUser: Hashable, Sendable {
    let email: String
    let name: String
}

/// Where a Google sign-in leads: home for a returning borrower, the profile screen for a new one.
enum GoogleSignInOutcome: Equatable, Sendable {
    case signedIn
    case needsProfile(GoogleUser)
}

/// Where the Google tokens come from: Google's own sign-in on the hosted build (AL-320). Returns nil when the
/// borrower cancels, and throws when Google refuses or can't be reached.
@MainActor
protocol GoogleTokenSource {
    func token() async throws -> GoogleToken?
}

/// Signs a borrower in with Google and saves the profile of a first-time Google user.
///
/// Errors are `AccountError`, the same as email sign-up, since both end in `POST /core/me`.
protocol GoogleSignInService: Sendable {
    func signIn(with token: GoogleToken) async throws -> GoogleSignInOutcome
    func completeProfile(_ profile: BorrowerProfile) async throws
}
