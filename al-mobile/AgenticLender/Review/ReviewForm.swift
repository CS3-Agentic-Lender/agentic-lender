import Foundation

/// Rating the app (AL-150, Figma 22 and 22a): one to five stars and an optional comment.
struct ReviewForm: Equatable {
    /// al-core's limit on the comment.
    static let maxCommentLength = 500

    /// 1 to 5, nil until a star is tapped.
    var rating: Int?
    var comment = ""

    private var trimmedComment: String { comment.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Submit stays disabled until a star is chosen, and while the comment is too long.
    var canSubmit: Bool { rating != nil && commentError == nil }

    var commentError: String? {
        trimmedComment.count > Self.maxCommentLength ? "Keep the comment to \(Self.maxCommentLength) characters" : nil
    }

    /// "4 out of 5", or the prompt before any star is tapped.
    var ratingText: String { rating.map { "\($0) out of 5" } ?? "Tap a star to rate" }

    /// "64 / 500" under the comment.
    var commentCount: String { "\(comment.count) / \(Self.maxCommentLength)" }

    /// The JSON for `PUT /core/reviews/me`, or nil until it can be submitted. A blank comment is left out.
    func body() -> Data? {
        guard canSubmit, let rating else { return nil }
        var json: [String: Any] = ["rating": rating]
        if !trimmedComment.isEmpty { json["comment"] = trimmedComment }
        return try? JSONSerialization.data(withJSONObject: json)
    }
}

/// The borrower's review as al-core stored it.
struct SavedReview: Equatable, Sendable {
    let rating: Int
    let comment: String?
    /// When they first reviewed; it stays the same when they update the review.
    let createdAt: Date?

    var form: ReviewForm { ReviewForm(rating: rating, comment: comment ?? "") }
}
