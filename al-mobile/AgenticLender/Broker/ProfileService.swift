import FirebaseAuth
import Foundation
import os

/// The signed-in borrower's profile and broker choice, from al-core.
@MainActor
protocol ProfileService {
    func loadProfile() async throws -> CoreProfile
    func loadBrokers() async throws -> [Broker]
    func chooseBroker(id: String) async throws -> CoreProfile
}

/// `ProfileService` against Firebase Auth and al-core: each call sends a fresh ID token.
struct FirebaseProfileService: ProfileService {
    private let api: CoreProfileAPI
    private let logger = Logger(category: "Profile")

    init(api: CoreProfileAPI = CoreProfileAPI(
        baseURL: BackendConfig().apiBaseURL,
        send: { try await URLSession.shared.data(for: $0) }
    )) {
        self.api = api
    }

    func loadProfile() async throws -> CoreProfile {
        try await api.profile(idToken: idToken())
    }

    func loadBrokers() async throws -> [Broker] {
        try await api.brokers(idToken: idToken())
    }

    func chooseBroker(id: String) async throws -> CoreProfile {
        try await api.chooseBroker(id: id, idToken: idToken())
    }

    private func idToken() async throws -> String {
        guard let user = Auth.auth().currentUser else {
            logger.error("A profile call was made with no signed-in Firebase user")
            throw AccountError.unknown
        }
        do {
            return try await user.getIDToken()
        } catch {
            logger.error("Getting the ID token failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError(authError: error)
        }
    }
}
