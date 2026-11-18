import Foundation

/// Where the app finds the local Firebase emulators started from `al-core/`, and the local API gateway,
/// or for the demo build (`BackendTarget.hosted`) the deployed API.
///
/// The iOS Simulator shares the Mac's network, so `localhost` works there.
/// A real iPhone can't see the Mac as `localhost`: set `EMULATOR_HOST` to the
/// Mac's Wi-Fi address in the scheme's environment variables (see README).
struct BackendConfig: Equatable {
    static let defaultEmulatorHost = "localhost"
    // Must match al-core/firebase.json.
    static let authEmulatorPort = 9099
    static let firestoreEmulatorPort = 8080
    // The local API gateway, which forwards /ai/* and /core/* (docs/infrastructure.md).
    static let apiGatewayPort = 8000

    let target: BackendTarget
    let emulatorHost: String
    /// The block explorer's transaction address, such as "https://amoy.polygonscan.com/tx/", for the loan
    /// note's "View on block explorer". Nil on the local Hardhat chain, which has no explorer.
    let blockExplorerTxURL: String?
    /// Stripe's publishable test key (`pk_test_…`) for the appraisal fee (AL-148). It comes from
    /// `AL_STRIPE_PUBLISHABLE_KEY` in the gitignored `Config/Hosted.xcconfig`, through Info.plist, so it holds
    /// when the app is opened from the home screen and is never in the repo. Only a `pk_test_` key is accepted;
    /// without one, Pay says the payment couldn't start.
    let stripePublishableKey: String?

    static let stripePublishableKeyInfo = "ALStripePublishableKey"

    /// Where the app sends API calls: the deployed API on a hosted build, otherwise the local gateway
    /// on the same host as the emulators.
    var apiBaseURL: URL {
        if target == .hosted { return URL(string: HostedBackend.apiBaseURL)! }
        var components = URLComponents()
        components.scheme = "http"
        components.host = emulatorHost
        components.port = Self.apiGatewayPort
        return components.url!
    }

    init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        info: [String: Any] = Bundle.main.infoDictionary ?? [:],
        target: BackendTarget = .current
    ) {
        self.target = target
        let host = environment["EMULATOR_HOST"]?.trimmingCharacters(in: .whitespaces) ?? ""
        emulatorHost = host.isEmpty ? Self.defaultEmulatorHost : host
        let explorer = environment["BLOCK_EXPLORER_TX_URL"]?.trimmingCharacters(in: .whitespaces) ?? ""
        blockExplorerTxURL = explorer.isEmpty ? nil : explorer
        let stripeKey = (info[Self.stripePublishableKeyInfo] as? String ?? "").trimmingCharacters(in: .whitespaces)
        stripePublishableKey = stripeKey.hasPrefix("pk_test_") ? stripeKey : nil
    }
}
