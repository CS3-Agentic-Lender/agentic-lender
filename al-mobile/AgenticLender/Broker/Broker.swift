import Foundation

/// A broker the borrower can choose, as `GET /core/brokers` sends it: no email or phone.
struct Broker: Decodable, Equatable, Identifiable, Sendable {
    let uid: String
    /// Optional because al-core sends `null` for a broker profile without a name.
    let name: String?
    /// `null` when the broker hasn't set a firm; the picker then shows only the name.
    let firm: String?

    var id: String { uid }

    /// "BM" for Bob Murphy: first letters of the first and last words, for the row's avatar.
    var initials: String {
        let words = (name ?? "").split(whereSeparator: \.isWhitespace)
        let letters = [words.first, words.count > 1 ? words.last : nil].compactMap { $0?.first }
        return String(letters).uppercased()
    }
}

extension CoreProfileAPI {
    static let brokersPath = "core/brokers"
    static let chooseBrokerPath = "core/me/broker"

    /// Every broker the borrower can choose, sorted by name by al-core.
    func brokers(idToken: String) async throws -> [Broker] {
        let (data, status) = try await perform(request(Self.brokersPath, idToken: idToken))
        return try decode([Broker].self, from: data, status: status, call: "GET /core/brokers")
    }

    /// Sets or changes the borrower's broker and returns the updated profile.
    func chooseBroker(id: String, idToken: String) async throws -> CoreProfile {
        var request = request(Self.chooseBrokerPath, idToken: idToken)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["broker_id": id])

        let (data, status) = try await perform(request)
        return try decode(CoreProfile.self, from: data, status: status, call: "PUT /core/me/broker")
    }
}
