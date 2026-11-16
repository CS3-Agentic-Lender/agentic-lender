import FirebaseAuth
import FirebaseCore
import FirebaseFirestore

/// Starts Firebase against the local emulators started from `al-core/`, or on the demo build
/// (`AL_BACKEND=HOSTED`) against the hosted Firebase project.
///
/// Local development uses the `demo-al` emulator project, so no
/// `GoogleService-Info.plist` or real API key is needed.
enum FirebaseSetup {
    static let projectID = "demo-al"
    // Placeholder IDs in the shape Firebase expects; the emulators ignore them.
    private static let demoAppID = "1:000000000000:ios:0000000000000000"
    private static let demoSenderID = "000000000000"
    private static let demoAPIKey = "demo-api-key"

    /// What `configure` will do for a build.
    enum Plan: Equatable {
        case emulators(host: String)
        case hosted(HostedFirebase)
        /// A hosted build whose Firebase settings aren't all filled in, named.
        case missing([String])
    }

    static func plan(for backend: BackendConfig, hosted: HostedFirebase = HostedBackend.firebase) -> Plan {
        switch backend.target {
        case .local:
            return .emulators(host: backend.emulatorHost)
        case .hosted:
            return hosted.missing.isEmpty ? .hosted(hosted) : .missing(hosted.missing)
        }
    }

    static func configure(backend: BackendConfig = BackendConfig()) {
        guard FirebaseApp.app() == nil else { return }

        switch plan(for: backend) {
        case .emulators(let host):
            configureEmulators(host: host)
        case .hosted(let firebase):
            let options = FirebaseOptions(googleAppID: firebase.appID, gcmSenderID: firebase.senderID)
            options.projectID = firebase.projectID
            options.apiKey = firebase.apiKey
            FirebaseApp.configure(options: options)
        case .missing(let names):
            // A build mistake, not something a borrower can fix: stop at launch with the names.
            fatalError("AL_BACKEND=HOSTED but HostedBackend.firebase is missing: \(names.joined(separator: ", "))")
        }
    }

    private static func configureEmulators(host: String) {
        let options = FirebaseOptions(googleAppID: demoAppID, gcmSenderID: demoSenderID)
        options.projectID = projectID
        options.apiKey = demoAPIKey
        FirebaseApp.configure(options: options)

        Auth.auth().useEmulator(withHost: host, port: BackendConfig.authEmulatorPort)

        let settings = Firestore.firestore().settings
        settings.host = "\(host):\(BackendConfig.firestoreEmulatorPort)"
        settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings()
        Firestore.firestore().settings = settings
    }
}
