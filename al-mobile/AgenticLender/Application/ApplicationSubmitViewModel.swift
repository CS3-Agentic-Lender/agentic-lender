import Observation
import os

/// Submits the saved Draft from "Check your application" (Figma 13 Review, 13a Confirm, 13b Submitted).
///
/// Submit asks for confirmation first, because once submitted the AI review starts and the
/// application can't be changed. Cancelling leaves it a Draft.
@MainActor
@Observable
final class ApplicationSubmitViewModel {
    let review: ApplicationReview
    private(set) var isConfirming = false
    private(set) var isSubmitting = false
    private(set) var submitError: String?
    /// Set once al-core has the application as Applied.
    private(set) var reference: ApplicationReference?

    private let applicationID: String
    private let service: ApplicationService
    private let logger = Logger(category: "Application")

    init(review: ApplicationReview, applicationID: String, service: ApplicationService) {
        self.review = review
        self.applicationID = applicationID
        self.service = service
    }

    var canSubmit: Bool { !isSubmitting && reference == nil }

    func requestSubmit() {
        guard canSubmit else { return }
        isConfirming = true
    }

    func cancelSubmit() {
        isConfirming = false
    }

    func confirmSubmit() async {
        isConfirming = false
        guard canSubmit else { return }
        submitError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await service.submit(id: applicationID)
            reference = ApplicationReference(applicationID: applicationID)
        } catch let error as ApplicationSaveError {
            submitError = Self.message(for: error)
        } catch {
            logger.error("Unexpected error submitting the application: \(error.localizedDescription, privacy: .public)")
            submitError = Self.message(for: .unavailable)
        }
    }

    /// The save messages, reworded where they talk about saving.
    static func message(for error: ApplicationSaveError) -> String {
        switch error {
        case .network: "We couldn't submit your application. Check your connection and try again."
        case .signedOut: "You've been signed out. Sign in again to submit your application."
        case .unavailable: "We couldn't submit your application right now. Try again in a moment."
        default: error.message
        }
    }
}
