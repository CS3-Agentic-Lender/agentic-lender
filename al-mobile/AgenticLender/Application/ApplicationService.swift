/// Saves, changes and reads back a borrower's application draft through al-core.
protocol ApplicationService: Sendable {
    /// `POST /core/applications`: a new Draft, or the borrower's existing one unchanged.
    func saveDraft(_ draft: ApplicationDraft) async throws -> DraftSaveOutcome
    /// `PATCH /core/applications/{id}`: changes a Draft to match the form.
    func editDraft(id: String, _ draft: ApplicationDraft) async throws
    /// `GET /core/applications/{id}`: the application as saved.
    func loadApplication(id: String) async throws -> StoredApplication
    /// `POST /core/applications/{id}/submit`: the Draft becomes Applied, which starts the AI review.
    func submit(id: String) async throws -> StoredApplication
}

/// What `POST /core/applications` did with the draft.
enum DraftSaveOutcome: Equatable, Sendable {
    /// A new Draft was saved (201).
    case created(id: String)
    /// The borrower already had a Draft; al-core returned it unchanged and didn't save this one (200).
    case existingDraft(id: String)
}

/// Why a draft couldn't be saved, with a message the borrower can act on.
enum ApplicationSaveError: Error, Equatable {
    case network
    case signedOut
    /// A submitted application is still in progress (409): one active application per borrower.
    case inProgress
    /// The application was submitted, so it can no longer be changed (409 on PATCH).
    case submitted
    /// al-core has no such application for this borrower (404), so the kept id is stale.
    case draftNotFound
    /// The borrower has no profile yet (409).
    case noProfile
    /// The borrower hasn't chosen a broker yet (409).
    case noBroker
    /// al-core didn't accept one field (422), named the way the form names it.
    case invalidField(String)
    /// A submit needs a field the Draft hasn't filled in (422), named the way the form names it.
    case missingToSubmit(String)
    /// Any other refusal (409 or 422), with al-core's own message.
    case rejected(String)
    case unavailable

    var message: String {
        switch self {
        case .network:
            "We couldn't save your application. Check your connection and try again."
        case .signedOut:
            "You've been signed out. Sign in again to save your application."
        case .inProgress:
            "You already have an application in progress, so you can't start another."
        case .submitted:
            "Submitted applications can't be changed"
        case .draftNotFound:
            "We couldn't find your saved draft. Save again to start a new one."
        case .noProfile:
            "Finish your details before you start an application."
        case .noBroker:
            "Choose a broker before you start an application."
        case .invalidField(let name):
            "The \(name) wasn't accepted. Check it and save again."
        case .missingToSubmit(let name):
            "Add the \(name) before you submit."
        case .rejected(let message):
            message
        case .unavailable:
            "We couldn't save your application right now. Try again in a moment."
        }
    }
}
