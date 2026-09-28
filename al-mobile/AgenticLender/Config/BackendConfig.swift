import Foundation

/// Where the app finds the local Firebase emulators started from `al-core/`.
///
/// The iOS Simulator shares the Mac's network, so `localhost` works there.
/// A real iPhone can't see the Mac as `localhost`: set `EMULATOR_HOST` to the
/// Mac's Wi-Fi address in the scheme's environment variables (see README).
struct BackendConfig: Equatable {
    static let defaultEmulatorHost = "localhost"
    // Must match al-core/firebase.json.
    static let authEmulatorPort = 9099
    static let firestoreEmulatorPort = 8080

    let emulatorHost: String

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        let host = environment["EMULATOR_HOST"]?.trimmingCharacters(in: .whitespaces) ?? ""
        emulatorHost = host.isEmpty ? Self.defaultEmulatorHost : host
    }
}
