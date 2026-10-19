import Observation

/// Drives the home screen: the greeting with the borrower's first name, and their broker.
@MainActor
@Observable
final class HomeViewModel {
    private(set) var profile: CoreProfile

    /// `profile` comes from the gate, which has already loaded it from al-core.
    init(profile: CoreProfile) {
        self.profile = profile
    }

    /// "Hello, Aoife", or just "Hello" if the name is blank.
    var greeting: String {
        Self.firstName(from: profile.fullName).map { "Hello, \($0)" } ?? "Hello"
    }

    var brokerName: String? { profile.brokerName }
    var brokerFirm: String? { profile.brokerFirm }

    func brokerChanged(_ profile: CoreProfile) {
        self.profile = profile
    }

    static func firstName(from fullName: String) -> String? {
        fullName.split(whereSeparator: \.isWhitespace).first.map(String.init)
    }
}
