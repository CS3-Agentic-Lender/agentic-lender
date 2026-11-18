import FirebaseAuth
import FirebaseFirestore
import Foundation
import os

/// Reads the borrower's review and saves a new one (AL-150).
@MainActor
protocol ReviewService {
    /// Their saved review, or nil if they haven't reviewed yet.
    func load() async throws -> SavedReview?
    func save(_ body: Data) async throws -> SavedReview
}

/// Saves with `PUT /core/reviews/me` through the API gateway, and reads `reviews/{uid}` straight from
/// Firestore, which lets a borrower read their own review (api-design.md, section 5).
struct APIReviewService: ReviewService {
    static let path = "core/reviews/me"

    let baseURL: URL
    let session: URLSession
    let idToken: @Sendable () async throws -> String
    /// The signed-in borrower's uid, for reading their review.
    let uid: () -> String?

    func save(_ body: Data) async throws -> SavedReview {
        let gateway = APIGateway(baseURL: baseURL, session: session, idToken: idToken, logger: Logger(category: "Review"))
        return try await gateway.put(Self.path, body: body, decode: Self.decode)
    }

    func load() async throws -> SavedReview? {
        guard let uid = uid() else { throw APIError.signedOut }
        let snapshot = try await Firestore.firestore().collection("reviews").document(uid).getDocument()
        guard let data = snapshot.data(), let rating = (data["rating"] as? NSNumber)?.intValue else { return nil }
        return SavedReview(rating: rating, comment: data["comment"] as? String, createdAt: (data["createdAt"] as? Timestamp)?.dateValue())
    }

    static func decode(_ data: Data) throws -> SavedReview {
        struct Answer: Decodable {
            let rating: Int
            let comment: String?
            let created_at: String?
        }
        let answer = try JSONDecoder().decode(Answer.self, from: data)
        return SavedReview(rating: answer.rating, comment: answer.comment, createdAt: answer.created_at.flatMap(ISO8601Timestamp.date(from:)))
    }

    /// The service the app uses: the configured gateway and the signed-in Firebase user.
    static func live(backend: BackendConfig = BackendConfig()) -> APIReviewService {
        APIReviewService(
            baseURL: backend.apiBaseURL, session: .shared,
            idToken: {
                guard let user = Auth.auth().currentUser else { throw APIError.signedOut }
                do {
                    return try await user.getIDToken()
                } catch {
                    throw AuthErrorCode(rawValue: (error as NSError).code) == .networkError ? APIError.network : APIError.signedOut
                }
            },
            uid: { Auth.auth().currentUser?.uid }
        )
    }
}
