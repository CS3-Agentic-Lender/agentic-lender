import Observation
import os

/// The "My application" timeline, live (AL-102, AL-103). It listens to the application, so a status
/// change shows without a refresh, and offline it keeps the last known status with a banner (Figma 14d).
@MainActor
@Observable
final class ApplicationStatusViewModel {
    static let offlineBanner = "Offline. Showing your last saved status."

    private(set) var timeline: StatusTimeline?
    /// LTV, DTI and approval likelihood (AL-145); live like the timeline.
    private(set) var figures: LoanFigures?
    /// The loan note under the timeline (Figma 14c); live like the timeline.
    private(set) var loanNote: LoanNoteSection = .hidden
    private(set) var loadError: String?
    private(set) var isLoading = true
    /// Show the "Offline" banner: Firestore's last answer came from the phone's cache (or its connection
    /// dropped), or the phone has no network at all. Firestore can take a while to decide it's offline,
    /// so the phone's own connection counts too.
    var isOffline: Bool { isServedFromCache || !hasNetwork }

    private var isServedFromCache = false
    private var hasNetwork = true
    /// "Ref 7f3k9qx2", the reference the borrower saw when they submitted, kept as stored.
    let reference: String

    private let applicationID: String
    private let service: ApplicationStatusService
    private let network: NetworkMonitor
    private var listener: LiveListener?
    private var networkWatch: LiveListener?
    private let logger = Logger(category: "Status")

    init(applicationID: String, service: ApplicationStatusService, network: NetworkMonitor) {
        self.applicationID = applicationID
        self.service = service
        self.network = network
        reference = "Ref \(ApplicationReference(applicationID: applicationID).text)"
    }

    /// Starts listening. Does nothing while already listening, so it's safe on every appear.
    func start() {
        if networkWatch == nil {
            networkWatch = network.watch { [weak self] connected in
                self?.hasNetwork = connected
            }
        }
        guard listener == nil else { return }
        isLoading = timeline == nil
        loadError = nil
        listener = service.listen(to: applicationID) { [weak self] result in
            self?.received(result)
        }
    }

    /// After a failure: listens again from scratch.
    func retry() {
        listener?.stop()
        listener = nil
        start()
    }

    private func received(_ result: Result<StatusUpdate, ApplicationStatusError>) {
        isLoading = false
        switch result {
        case .success(let update):
            timeline = StatusTimeline(record: update.record)
            figures = update.record.status == .draft ? nil : update.record.figures
            loanNote = LoanNoteSection(record: update.record)
            isServedFromCache = update.isFromCache
            if !update.isFromCache {
                // A fresh answer from the server can only come over a working connection, even if the
                // network watch hasn't noticed it's back yet.
                hasNetwork = true
            }
            loadError = nil
        case .failure(.network) where timeline != nil:
            // Keep what the borrower last saw; Firestore carries on listening and catches up when back.
            isServedFromCache = true
        case .failure(.network):
            loadError = Self.message(for: .network)
        case .failure(let error):
            // Firestore ends a listener after a real error, so Retry has to set up a new one.
            logger.error("The status listener stopped: \(String(describing: error), privacy: .public)")
            listener = nil
            loadError = Self.message(for: error)
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
