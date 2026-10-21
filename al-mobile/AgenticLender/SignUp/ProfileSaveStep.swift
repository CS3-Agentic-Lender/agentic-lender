/// Sign-up's profile save, once the Firebase login exists (AL-239).
///
/// A dropped connection or a server error is tried once more after a short pause: a repeat
/// `POST /core/me` is safe, because al-core answers 200 with the same profile. Only when the profile
/// really couldn't be saved is the new login removed, so the borrower can sign up again with the same email.
struct ProfileSaveStep {
    static let retryDelay: Duration = .seconds(1)

    let save: () async throws -> Void
    let removeLogin: () async -> Void
    var pause: () async -> Void = { try? await Task.sleep(for: retryDelay) }

    /// Throws the `AccountError` to show once the login has been removed.
    func run() async throws {
        do {
            try await saveWithOneRetry()
        } catch {
            await removeLogin()
            throw Self.accountError(for: error)
        }
    }

    private func saveWithOneRetry() async throws {
        do {
            try await save()
        } catch where Self.isWorthRetrying(error) {
            await pause()
            // A cancelled sleep ends early; don't retry for a sign-up that was abandoned.
            guard !Task.isCancelled else { throw error }
            try await save()
        }
    }

    private static func isWorthRetrying(_ error: Error) -> Bool {
        error as? AccountError == .network || error is CoreProfileAPI.ServerError
    }

    /// A server error shows "Your details couldn't be saved"; anything else as it came.
    private static func accountError(for error: Error) -> AccountError {
        error as? AccountError ?? .profileNotSaved
    }
}
