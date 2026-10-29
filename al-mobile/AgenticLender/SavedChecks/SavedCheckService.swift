import Foundation

/// Why saving, deleting or reading saved checks failed. Each screen words it for itself.
enum SavedCheckError: Error, Equatable {
    case network
    case signedOut
    /// The borrower already keeps the most al-core allows (409 on the 21st).
    case limitReached
    case unavailable
}

/// Stops a live listener. It also stops when it's let go of, so a listener never outlives the screen
/// that holds it. Stopping twice does nothing.
final class SavedChecksListener {
    private var stopListening: (() -> Void)?

    init(_ stop: @escaping () -> Void) {
        stopListening = stop
    }

    func stop() {
        stopListening?()
        stopListening = nil
    }

    deinit {
        stop()
    }
}

/// The borrower's saved property checks: saved and deleted through al-core, read straight from
/// Firestore, which the rules allow for the borrower's own checks only.
@MainActor
protocol SavedCheckService {
    /// `POST /core/saved-checks`. Returns the new check's id.
    func save(_ draft: SavedCheckDraft) async throws -> String
    /// `DELETE /core/saved-checks/{id}`. A check that's already gone counts as deleted.
    func delete(id: String) async throws
    /// Calls `onChange` with every saved check, newest first, now and after every change, until stopped.
    func listen(onChange: @escaping (Result<[SavedCheck], SavedCheckError>) -> Void) -> SavedChecksListener
}
