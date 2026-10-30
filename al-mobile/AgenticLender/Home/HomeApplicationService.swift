import FirebaseAuth
import FirebaseFirestore
import Foundation
import Observation
import os

/// The borrower's applications, live, for the card on Home. Firestore's rules let a borrower list
/// their own (`borrowerId == uid`).
@MainActor
protocol HomeApplicationService {
    /// Calls `onChange` with the newest application, or nil when there is none, now and after every change.
    func listen(onChange: @escaping (Result<HomeApplication?, ApplicationStatusError>) -> Void) -> LiveListener
}

struct FirestoreHomeApplicationService: HomeApplicationService {
    private let logger = Logger(category: "Home")

    nonisolated init() {}

    func listen(onChange: @escaping (Result<HomeApplication?, ApplicationStatusError>) -> Void) -> LiveListener {
        guard let uid = Auth.auth().currentUser?.uid else {
            onChange(.failure(.notFound))
            return LiveListener {}
        }
        let logger = logger
        let registration = Firestore.firestore().collection("applications")
            .whereField("borrowerId", isEqualTo: uid)
            .addSnapshotListener { snapshot, error in
                if let error {
                    logger.error("Listening to the borrower's applications failed: \(error.localizedDescription, privacy: .public)")
                    onChange(.failure((error as NSError).code == FirestoreErrorCode.unavailable.rawValue ? .network : .unavailable))
                    return
                }
                let applications = (snapshot?.documents ?? []).compactMap { document in
                    HomeApplication(id: document.documentID, fields: FirestoreApplicationStatusService.withDates(document.data()))
                }
                onChange(.success(HomeApplication.newest(of: applications)))
            }
        return LiveListener { registration.remove() }
    }
}

/// The application card's state: loading, no application yet (Figma 14f), the newest application,
/// or a failure with Retry. It listens once and updates live (criterion 3).
@MainActor
@Observable
final class HomeApplicationCardModel {
    enum State: Equatable {
        case loading
        case none
        case application(HomeApplication)
        case failed(String)
    }

    static let noApplicationText = "Start by checking what you could borrow. It takes about two minutes."

    private(set) var state: State = .loading
    private let service: HomeApplicationService
    private var listener: LiveListener?

    init(service: HomeApplicationService) {
        self.service = service
    }

    func start() {
        guard listener == nil else { return }
        state = .loading
        listener = service.listen { [weak self] result in
            self?.received(result)
        }
    }

    func retry() {
        listener?.stop()
        listener = nil
        start()
    }

    private func received(_ result: Result<HomeApplication?, ApplicationStatusError>) {
        switch result {
        case .success(let application):
            state = application.map(State.application) ?? .none
        case .failure(let error):
            // Firestore ends a listener after an error, so Retry sets up a new one.
            listener = nil
            state = .failed(ApplicationStatusViewModel.message(for: error))
        }
    }
}
