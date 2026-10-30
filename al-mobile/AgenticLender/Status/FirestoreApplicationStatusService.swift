import FirebaseFirestore
import Foundation
import os

/// Listens to `applications/{id}` in Firestore (AL-103). The rules let a borrower read only their own.
///
/// It also hears metadata changes, so it knows when an answer comes from the phone's cache because the
/// network is down, and again when the server answers.
struct FirestoreApplicationStatusService: ApplicationStatusService {
    private let logger = Logger(category: "Status")

    func listen(to applicationID: String, onChange: @escaping (Result<StatusUpdate, ApplicationStatusError>) -> Void) -> LiveListener {
        let logger = logger
        let registration = Firestore.firestore().collection("applications").document(applicationID)
            .addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                if let error {
                    onChange(.failure(Self.statusError(for: error as NSError, logger: logger)))
                    return
                }
                guard let snapshot else { return }
                let update = Self.update(from: snapshot.data(), isFromCache: snapshot.metadata.isFromCache)
                if case .failure(.unavailable) = update {
                    logger.error("Application \(applicationID, privacy: .private) has a status the app doesn't know")
                }
                onChange(update)
            }
        return LiveListener { registration.remove() }
    }

    /// One snapshot as an update. No document from the server means there's no such application; no
    /// document in the cache only means nothing has loaded yet while offline.
    nonisolated static func update(from data: [String: Any]?, isFromCache: Bool) -> Result<StatusUpdate, ApplicationStatusError> {
        guard let data else { return .failure(isFromCache ? .network : .notFound) }
        guard let record = ApplicationStatusRecord(fields: withDates(data)) else { return .failure(.unavailable) }
        return .success(StatusUpdate(record: record, isFromCache: isFromCache))
    }

    /// Firestore timestamps as `Date`, however deep they sit (the decision map, the history entries).
    nonisolated static func withDates(_ value: [String: Any]) -> [String: Any] {
        value.mapValues(convert)
    }

    nonisolated private static func convert(_ value: Any) -> Any {
        switch value {
        case let timestamp as Timestamp: timestamp.dateValue()
        case let map as [String: Any]: withDates(map)
        case let list as [Any]: list.map(convert)
        default: value
        }
    }

    nonisolated private static func statusError(for error: NSError, logger: Logger) -> ApplicationStatusError {
        guard error.domain == FirestoreErrorDomain else {
            logger.error("Listening to the application failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unavailable, .deadlineExceeded: return .network
        case .permissionDenied, .notFound: return .notFound
        default:
            logger.error("Listening to the application failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
    }
}
