import Observation
import os

/// Drives the broker picker (Figma 06 Choose broker): after sign-up with Continue, or from
/// home's "Your broker" card with Save.
@MainActor
@Observable
final class BrokerPickerViewModel {
    enum Mode: Equatable {
        /// A borrower without a broker, who can't reach home until they choose one.
        case choose
        /// A borrower changing from the broker in `current`.
        case change(current: CoreProfile)
    }

    enum State: Equatable {
        case loading
        case loaded([Broker])
        /// The list couldn't load or is empty; the message says which, with Retry.
        case failed(String)
    }

    static let noBrokersMessage = "No brokers are available yet."
    static let listFailedMessage = "Couldn't load the brokers. Try again."
    static let saveFailedMessage = "Couldn't save your broker. Try again."

    let mode: Mode
    private(set) var state = State.loading
    private(set) var selectedID: String?
    private(set) var isSaving = false
    private(set) var saveError: String?

    private let service: ProfileService
    private let logger = Logger(category: "Broker")

    init(mode: Mode, service: ProfileService) {
        self.mode = mode
        self.service = service
        if case .change(let current) = mode {
            selectedID = current.brokerID
        }
    }

    var title: String {
        mode == .choose ? "Choose your broker" : "Change broker"
    }

    var buttonTitle: String {
        mode == .choose ? "Continue" : "Save"
    }

    /// Agreed on 13 Oct: applications made before a change stay with the old broker.
    var existingApplicationsNote: String? {
        guard case .change(let current) = mode, let name = current.brokerName, !name.trimmed.isEmpty else { return nil }
        return "Applications you've already started stay with \(name)."
    }

    /// A broker is selected, and when changing, it isn't the current one.
    var canSave: Bool {
        guard let selectedID, !isSaving else { return false }
        if case .change(let current) = mode { return selectedID != current.brokerID }
        return true
    }

    func load() async {
        state = .loading
        do {
            let brokers = try await service.loadBrokers().filter { !($0.name?.trimmed.isEmpty ?? true) }
            state = brokers.isEmpty ? .failed(Self.noBrokersMessage) : .loaded(brokers)
        } catch {
            logger.error("Loading the brokers failed: \(error.localizedDescription, privacy: .public)")
            state = .failed(error as? AccountError == .network ? CommonMessage.cantReachServer : Self.listFailedMessage)
        }
    }

    func select(_ broker: Broker) {
        selectedID = broker.uid
        saveError = nil
    }

    /// Saves the selected broker and returns the updated profile, or nil with `saveError` set.
    /// The selection stays as it was, so the borrower can try again.
    func save() async -> CoreProfile? {
        guard let selectedID, !isSaving else { return nil }
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            return try await service.chooseBroker(id: selectedID)
        } catch {
            logger.error("Saving the broker failed: \(error.localizedDescription, privacy: .public)")
            saveError = error as? AccountError == .network ? CommonMessage.cantReachServer : Self.saveFailedMessage
            return nil
        }
    }
}
