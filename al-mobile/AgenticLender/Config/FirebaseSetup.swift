import FirebaseAuth
import FirebaseCore
import FirebaseFirestore

/// Starts Firebase against the local emulators started from `al-core/`.
///
/// Local development uses the `demo-al` emulator project, so no
/// `GoogleService-Info.plist` or real API key is needed. The live
/// configuration arrives with the demo build against the deployed backend.
enum FirebaseSetup {
    static let projectID = "demo-al"
    // Placeholder IDs in the shape Firebase expects; the emulators ignore them.
    private static let demoAppID = "1:000000000000:ios:0000000000000000"
    private static let demoSenderID = "000000000000"
    private static let demoAPIKey = "demo-api-key"

    static func configure(backend: BackendConfig = BackendConfig()) {
        guard FirebaseApp.app() == nil else { return }

        let options = FirebaseOptions(googleAppID: demoAppID, gcmSenderID: demoSenderID)
        options.projectID = projectID
        options.apiKey = demoAPIKey
        FirebaseApp.configure(options: options)

        Auth.auth().useEmulator(withHost: backend.emulatorHost, port: BackendConfig.authEmulatorPort)

        let settings = Firestore.firestore().settings
        settings.host = "\(backend.emulatorHost):\(BackendConfig.firestoreEmulatorPort)"
        settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings()
        Firestore.firestore().settings = settings
    }
}
