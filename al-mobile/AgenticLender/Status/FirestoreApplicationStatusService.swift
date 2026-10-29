import FirebaseFirestore
import Foundation
import os

/// Reads `applications/{id}` from Firestore once. The rules let a borrower read only their own.
struct FirestoreApplicationStatusService: ApplicationStatusService {
    private let logger = Logger(category: "Status")

    func status(of applicationID: String) async throws -> ApplicationStatusRecord {
        let snapshot: DocumentSnapshot
        do {
            snapshot = try await Firestore.firestore().collection("applications").document(applicationID).getDocument()
        } catch {
            throw Self.statusError(for: error as NSError, logger: logger)
        }
        guard let data = snapshot.data() else { throw ApplicationStatusError.notFound }
        guard let record = ApplicationStatusRecord(fields: Self.withDates(data)) else {
            logger.error("Application \(applicationID, privacy: .private) has a status the app doesn't know")
            throw ApplicationStatusError.unavailable
        }
        return record
    }

    /// Firestore timestamps as `Date`, however deep they sit (the decision map, the history entries).
    static func withDates(_ value: [String: Any]) -> [String: Any] {
        value.mapValues(convert)
    }

    private static func convert(_ value: Any) -> Any {
        switch value {
        case let timestamp as Timestamp: timestamp.dateValue()
        case let map as [String: Any]: withDates(map)
        case let list as [Any]: list.map(convert)
        default: value
        }
    }

    private static func statusError(for error: NSError, logger: Logger) -> ApplicationStatusError {
        guard error.domain == FirestoreErrorDomain else {
            logger.error("Reading the application failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unavailable, .deadlineExceeded: return .network
        case .permissionDenied, .notFound: return .notFound
        default:
            logger.error("Reading the application failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
    }
}
