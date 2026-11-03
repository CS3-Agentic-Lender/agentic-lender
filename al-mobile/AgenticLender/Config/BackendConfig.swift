import Foundation

/// Where the app finds the local Firebase emulators started from `al-core/`, and the local API gateway.
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

    let emulatorHost: String
    /// The block explorer's transaction address, such as "https://amoy.polygonscan.com/tx/", for the loan
    /// note's "View on block explorer". Nil on the local Hardhat chain, which has no explorer.
    let blockExplorerTxURL: String?

    /// Where the app sends API calls: the local gateway on the same host as the emulators.
    var apiBaseURL: URL {
        var components = URLComponents()
        components.scheme = "http"
        components.host = emulatorHost
        components.port = Self.apiGatewayPort
        return components.url!
    }

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        let host = environment["EMULATOR_HOST"]?.trimmingCharacters(in: .whitespaces) ?? ""
        emulatorHost = host.isEmpty ? Self.defaultEmulatorHost : host
        let explorer = environment["BLOCK_EXPLORER_TX_URL"]?.trimmingCharacters(in: .whitespaces) ?? ""
        blockExplorerTxURL = explorer.isEmpty ? nil : explorer
    }
}
