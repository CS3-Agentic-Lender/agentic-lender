import FirebaseAuth
import FirebaseFirestore
import Foundation
import os

/// Reads the borrower's thread from Firestore: their applications (`borrowerId == uid`, which the
/// rules allow) and the newest submitted one's `messages`, listened to live. Sending and marking
/// read go through al-core (`APIMessageSender`).
@MainActor
final class FirestoreMessageService: MessageService {
    private let logger = Logger(category: "Messages")
    private let sender: APIMessageSender

    nonisolated init(sender: APIMessageSender = .live()) {
        self.sender = sender
    }

    var myID: String? { Auth.auth().currentUser?.uid }

    func currentApplicationID() async throws -> String? {
        guard let uid = myID else { throw MessageError.signedOut }
        let snapshot: QuerySnapshot
        do {
            snapshot = try await Firestore.firestore().collection("applications")
                .whereField("borrowerId", isEqualTo: uid)
                .getDocuments()
        } catch {
            throw messageError(for: error as NSError)
        }
        // Newest first, leaving out Drafts: the broker can't read a Draft or its messages.
        return snapshot.documents
            .filter { ($0.data()["status"] as? String) != ApplicationDraftStatus.draft }
            .max { createdAt($0) < createdAt($1) }?
            .documentID
    }

    func listen(to applicationID: String, onChange: @escaping (Result<[Message], MessageError>) -> Void) -> MessageListener {
        let registration = Firestore.firestore()
            .collection("applications").document(applicationID).collection("messages")
            .order(by: "sentAt")
            .addSnapshotListener { [weak self] snapshot, error in
                guard let self else { return }
                if let error {
                    onChange(.failure(self.messageError(for: error as NSError)))
                    return
                }
                let messages = (snapshot?.documents ?? []).compactMap { document in
                    Message(id: document.documentID, fields: Self.withDates(document.data()))
                }
                onChange(.success(messages))
            }
        return MessageListener { registration.remove() }
    }

    func send(_ text: String, on applicationID: String) async throws -> String {
        try await sender.send(text, on: applicationID)
    }

    func markRead(on applicationID: String) async throws {
        try await sender.markRead(on: applicationID)
    }

    private func createdAt(_ document: QueryDocumentSnapshot) -> Date {
        (document.data()["createdAt"] as? Timestamp)?.dateValue() ?? .distantPast
    }

    /// Firestore timestamps as `Date`, so `Message` doesn't depend on Firebase.
    private static func withDates(_ fields: [String: Any]) -> [String: Any] {
        fields.mapValues { ($0 as? Timestamp)?.dateValue() ?? $0 }
    }

    private func messageError(for error: NSError) -> MessageError {
        guard error.domain == FirestoreErrorDomain else {
            logger.error("Reading messages failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unavailable, .deadlineExceeded: return .network
        case .unauthenticated: return .signedOut
        default:
            logger.error("Reading messages failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
    }
}

/// The status al-core gives an application that hasn't been submitted (SCHEMA.md).
private enum ApplicationDraftStatus {
    static let draft = "Draft"
}
