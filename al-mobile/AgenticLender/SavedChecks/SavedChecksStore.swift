import Observation
import os

/// The borrower's saved checks, live, for the Properties list (Figma 09, 09a) and the application
/// form's picker. Deleting goes through al-core; the listener then drops the check from the list.
@MainActor
@Observable
final class SavedChecksStore {
    enum State: Equatable {
        case loading
        case ready([SavedCheck])
        case failed(String)
    }

    private(set) var state: State = .loading
    /// Why the last delete failed. Cleared by the next one.
    private(set) var deleteError: String?

    private let service: SavedCheckService
    private var listener: SavedChecksListener?
    private let logger = Logger(category: "SavedChecks")

    init(service: SavedCheckService) {
        self.service = service
    }

    /// Newest first. Empty until the first answer arrives.
    var checks: [SavedCheck] {
        guard case .ready(let checks) = state else { return [] }
        return checks
    }

    /// Starts listening. Does nothing while already listening, so it's safe to call on every appear,
    /// and after a failure it starts again (Retry).
    func start() {
        guard listener == nil else { return }
        state = .loading
        listener = service.listen { [weak self] result in
            self?.received(result)
        }
    }

    func delete(_ check: SavedCheck) async {
        deleteError = nil
        do {
            try await service.delete(id: check.id)
        } catch let error as SavedCheckError {
            deleteError = Self.deleteMessage(for: error)
        } catch {
            logger.error("Unexpected error deleting a saved check: \(error.localizedDescription, privacy: .public)")
            deleteError = Self.deleteMessage(for: .unavailable)
        }
    }

    private func received(_ result: Result<[SavedCheck], SavedCheckError>) {
        switch result {
        case .success(let checks):
            state = .ready(checks)
        case .failure(let error):
            // Firestore ends a listener after an error, so the next start() sets up a new one.
            listener = nil
            state = .failed(Self.message(for: error))
        }
    }

    static func message(for error: SavedCheckError) -> String {
        switch error {
        case .network: "We couldn't load your properties. Check your connection and try again."
        case .signedOut: "You've been signed out. Sign in again to see your properties."
        case .limitReached, .unavailable: "We couldn't load your properties right now. Try again in a moment."
        }
    }

    static func deleteMessage(for error: SavedCheckError) -> String {
        switch error {
        case .network: "We couldn't delete that property. Check your connection and try again."
        case .signedOut: "You've been signed out. Sign in again to delete a property."
        case .limitReached, .unavailable: "We couldn't delete that property right now. Try again in a moment."
        }
    }
}

/// "Save this property" on the result screen (Figma 11d). Saved once; a failed save can be tried again.
@MainActor
@Observable
final class SaveCheckModel {
    enum State: Equatable {
        case idle
        case saving
        case saved
        case failed(String)
    }

    private(set) var state: State = .idle

    private let draft: SavedCheckDraft
    private let service: SavedCheckService
    private let logger = Logger(category: "SavedChecks")

    init(draft: SavedCheckDraft, service: SavedCheckService) {
        self.draft = draft
        self.service = service
    }

    var canSave: Bool { state != .saving && state != .saved }

    func save() async {
        guard canSave else { return }
        state = .saving
        do {
            _ = try await service.save(draft)
            state = .saved
        } catch let error as SavedCheckError {
            state = .failed(Self.message(for: error))
        } catch {
            logger.error("Unexpected error saving a check: \(error.localizedDescription, privacy: .public)")
            state = .failed(Self.message(for: .unavailable))
        }
    }

    static func message(for error: SavedCheckError) -> String {
        switch error {
        case .network: "We couldn't save this property. Check your connection and try again."
        case .signedOut: "You've been signed out. Sign in again to save this property."
        case .limitReached: "You've saved 20 properties, the most you can keep. Delete one in Properties to save this one."
        case .unavailable: "We couldn't save this property right now. Try again in a moment."
        }
    }
}
