/// Saves a borrower's application draft through al-core.
protocol ApplicationService: Sendable {
    func saveDraft(_ draft: ApplicationDraft) async throws -> DraftSaveOutcome
}

/// What `POST /core/applications` did with the draft.
enum DraftSaveOutcome: Equatable, Sendable {
    /// A new Draft was saved (201).
    case created(id: String)
    /// The borrower already had a Draft; al-core returned it unchanged and didn't save this one (200).
    /// Changing an existing Draft is `PATCH /core/applications/{id}`.
    case existingDraft(id: String)
}

/// Why a draft couldn't be saved, with a message the borrower can act on.
enum ApplicationSaveError: Error, Equatable {
    case network
    case signedOut
    /// A submitted application is still in progress (409): one active application per borrower.
    case inProgress
    case unavailable

    var message: String {
        switch self {
        case .network:
            "We couldn't save your application. Check your connection and try again."
        case .signedOut:
            "You've been signed out. Sign in again to save your application."
        case .inProgress:
            "You already have an application in progress, so you can't start another."
        case .unavailable:
            "We couldn't save your application right now. Try again in a moment."
        }
    }
}
