import FirebaseAuth
import FirebaseFirestore
import Foundation
import os

/// The saved checks the app uses: al-core through the gateway for saving and deleting, and a Firestore
/// listener on `users/{uid}/saved_checks` for the list.
struct LiveSavedCheckService: SavedCheckService {
    let api: APISavedCheckClient

    private let logger = Logger(category: "SavedChecks")

    /// Nonisolated so a view can make one as a default argument; it only stores the client.
    nonisolated init(api: APISavedCheckClient) {
        self.api = api
    }

    nonisolated static func live(backend: BackendConfig = BackendConfig()) -> LiveSavedCheckService {
        let valuation = APIValuationService.live(backend: backend)
        return LiveSavedCheckService(api: APISavedCheckClient(
            baseURL: valuation.baseURL, session: valuation.session, idToken: valuation.idToken
        ))
    }

    func save(_ draft: SavedCheckDraft) async throws -> String {
        try await api.save(draft)
    }

    func delete(id: String) async throws {
        try await api.delete(id: id)
    }

    func listen(onChange: @escaping (Result<[SavedCheck], SavedCheckError>) -> Void) -> SavedChecksListener {
        guard let uid = Auth.auth().currentUser?.uid else {
            onChange(.failure(.signedOut))
            return SavedChecksListener {}
        }
        let logger = logger
        let registration = Firestore.firestore()
            .collection("users").document(uid).collection("saved_checks")
            .order(by: "createdAt", descending: true)
            .addSnapshotListener { snapshot, error in
                if let error {
                    onChange(.failure(Self.listError(for: error as NSError, logger: logger)))
                    return
                }
                let checks = (snapshot?.documents ?? []).compactMap { document in
                    SavedCheck(id: document.documentID, fields: Self.withDates(document.data()))
                }
                onChange(.success(checks))
            }
        return SavedChecksListener { registration.remove() }
    }

    /// `createdAt` arrives as a Firestore timestamp; the app reads dates.
    private static func withDates(_ fields: [String: Any]) -> [String: Any] {
        fields.mapValues { ($0 as? Timestamp)?.dateValue() ?? $0 }
    }

    private static func listError(for error: NSError, logger: Logger) -> SavedCheckError {
        guard error.domain == FirestoreErrorDomain else {
            logger.error("Listening to saved checks failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unavailable, .deadlineExceeded: return .network
        case .permissionDenied, .unauthenticated: return .signedOut
        default:
            logger.error("Listening to saved checks failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
    }
}
