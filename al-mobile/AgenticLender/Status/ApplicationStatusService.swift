import Foundation

/// Why the application's status couldn't be read.
enum ApplicationStatusError: Error, Equatable {
    case network
    /// No such application, or not the signed-in borrower's (the rules refuse it either way).
    case notFound
    case unavailable
}

/// Reads an application's status straight from Firestore, which the rules allow for its borrower.
protocol ApplicationStatusService: Sendable {
    func status(of applicationID: String) async throws -> ApplicationStatusRecord
}
