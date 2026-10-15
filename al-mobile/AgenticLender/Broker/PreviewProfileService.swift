#if DEBUG
/// Fixed answers for SwiftUI previews.
struct PreviewProfileService: ProfileService {
    func loadProfile() async throws -> CoreProfile {
        CoreProfile(fullName: "Alice Byrne", brokerID: nil, brokerName: nil, brokerFirm: nil)
    }

    func loadBrokers() async throws -> [Broker] {
        [
            Broker(uid: "broker1", name: "Bob Murphy", firm: "Murphy Mortgages"),
            Broker(uid: "broker2", name: "Ciara Kelly", firm: "Kelly Financial"),
        ]
    }

    func chooseBroker(id: String) async throws -> CoreProfile {
        CoreProfile(fullName: "Alice Byrne", brokerID: id, brokerName: "Bob Murphy", brokerFirm: "Murphy Mortgages")
    }
}
#endif
