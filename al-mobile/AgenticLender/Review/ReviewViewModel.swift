import Foundation
import Observation
import os

/// Drives Rate the app (AL-150, Figma 22 to 22c): it opens with the borrower's saved review if they
/// have one, saves, thanks them, and Edit review reopens the form with what was saved.
@MainActor
@Observable
final class ReviewViewModel {
    enum State: Equatable {
        case loading
        case editing
        case saving
        case thanks(SavedReview)
        /// The save failed; the form keeps the stars and comment.
        case failed(String)
    }

    static let failedMessage = "We couldn't save your review. Check your connection and try again."

    var form = ReviewForm()
    private(set) var state: State = .loading
    /// The review already saved, so the screen says "You reviewed on…" and "Update review".
    private(set) var saved: SavedReview?

    private let service: ReviewService
    private let logger = Logger(category: "Review")

    init(service: ReviewService) {
        self.service = service
    }

    /// "You reviewed on 29 Sep" (Figma 22c), once there's a saved review.
    var reviewedOn: String? {
        saved?.createdAt.map { "You reviewed on \(Self.dayFormatter.string(from: $0))" }
    }

    var submitTitle: String { saved == nil ? "Submit review" : "Update review" }

    var isSaving: Bool { state == .saving }

    /// A review that can't be read doesn't block a new one: the form just opens empty.
    func load() async {
        do {
            saved = try await service.load()
        } catch {
            logger.error("Loading the saved review failed: \(String(describing: error), privacy: .public)")
        }
        form = saved?.form ?? ReviewForm()
        state = .editing
    }

    func submit() async {
        guard !isSaving, let body = form.body() else { return }
        state = .saving
        do {
            let review = try await service.save(body)
            saved = review
            state = .thanks(review)
        } catch {
            logger.error("Saving the review failed: \(String(describing: error), privacy: .public)")
            state = .failed(Self.failedMessage)
        }
    }

    /// Figma 22b "Edit review": back to the form with the saved stars and comment.
    func edit() {
        form = saved?.form ?? form
        state = .editing
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_IE")
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return formatter
    }()
}
