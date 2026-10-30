import Observation
import os

/// Loads the "My application" timeline (AL-102) once. Live updates come with AL-103.
@MainActor
@Observable
final class ApplicationStatusViewModel {
    private(set) var timeline: StatusTimeline?
    private(set) var loadError: String?
    private(set) var isLoading = true
    /// "Ref 7f3k9qx2", the reference the borrower saw when they submitted, kept as stored.
    let reference: String

    private let applicationID: String
    private let service: ApplicationStatusService
    private let logger = Logger(category: "Status")

    init(applicationID: String, service: ApplicationStatusService) {
        self.applicationID = applicationID
        self.service = service
        reference = "Ref \(ApplicationReference(applicationID: applicationID).text)"
    }

    func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            timeline = StatusTimeline(record: try await service.status(of: applicationID))
        } catch let error as ApplicationStatusError {
            loadError = Self.message(for: error)
        } catch {
            logger.error("Unexpected error loading the application status: \(error.localizedDescription, privacy: .public)")
            loadError = Self.message(for: .unavailable)
        }
    }

    static func message(for error: ApplicationStatusError) -> String {
        switch error {
        case .network: "We couldn't load your application. Check your connection and try again."
        case .notFound: "We couldn't find this application. It may have been removed."
        case .unavailable: "We couldn't load your application right now. Try again in a moment."
        }
    }
}
