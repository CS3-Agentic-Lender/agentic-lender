import Foundation

/// Why the application's status couldn't be read.
enum ApplicationStatusError: Error, Equatable {
    case network
    /// No such application, or not the signed-in borrower's (the rules refuse it either way).
    case notFound
    case unavailable
}

/// One live answer: the status as stored, and whether it came from the phone's cache because the
/// network is down (AL-103).
struct StatusUpdate: Equatable {
    let record: ApplicationStatusRecord
    let isFromCache: Bool
}

/// Listens to an application's status straight from Firestore, which the rules allow for its borrower.
@MainActor
protocol ApplicationStatusService {
    /// Calls `onChange` now and after every change, until stopped.
    func listen(to applicationID: String, onChange: @escaping (Result<StatusUpdate, ApplicationStatusError>) -> Void) -> LiveListener
}
