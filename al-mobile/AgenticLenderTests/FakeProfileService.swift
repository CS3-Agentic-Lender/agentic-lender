@testable import AgenticLender

/// Answers the profile and broker calls with fixed results and records what was chosen.
@MainActor
final class FakeProfileService: ProfileService {
    var profileResult: Result<CoreProfile, AccountError> = .success(.alice)
    var brokersResult: Result<[Broker], AccountError> = .success([.bob, .ciara])
    var chooseResult: Result<CoreProfile, AccountError>?
    var signedInUser: GoogleUser? = GoogleUser(email: "alice@example.com", name: "Alice Byrne")
    private(set) var chosenBrokerIDs: [String] = []
    private(set) var profileLoads = 0
    private(set) var brokerLoads = 0

    func loadProfile() async throws -> CoreProfile {
        profileLoads += 1
        return try profileResult.get()
    }

    func loadBrokers() async throws -> [Broker] {
        brokerLoads += 1
        return try brokersResult.get()
    }

    func chooseBroker(id: String) async throws -> CoreProfile {
        chosenBrokerIDs.append(id)
        if let chooseResult { return try chooseResult.get() }
        let broker = try brokersResult.get().first { $0.uid == id }
        return CoreProfile(fullName: "Alice Byrne", brokerID: id, brokerName: broker?.name, brokerFirm: broker?.firm)
    }
}

extension Broker {
    static let bob = Broker(uid: "broker1", name: "Bob Murphy", firm: "Murphy Mortgages")
    static let ciara = Broker(uid: "broker2", name: "Ciara Kelly", firm: "Kelly Financial")
}

extension CoreProfile {
    /// A borrower who hasn't chosen a broker yet.
    static let alice = CoreProfile(fullName: "Alice Byrne", brokerID: nil, brokerName: nil, brokerFirm: nil)
    /// The same borrower with Bob Murphy as her broker.
    static let aliceWithBob = CoreProfile(
        fullName: "Alice Byrne", brokerID: "broker1", brokerName: "Bob Murphy", brokerFirm: "Murphy Mortgages"
    )
}
