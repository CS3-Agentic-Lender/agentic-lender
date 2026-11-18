import Foundation

/// Which backend this build talks to, set by the `AL_BACKEND` build setting (AL-184).
///
/// `LOCAL` (the default) uses the Firebase emulators and the local gateway. `HOSTED` is the demo
/// build: the hosted Firebase project and the deployed API. It's a compile condition rather than an
/// environment variable so it holds when the app is opened from the home screen, not only from Xcode.
/// Build it with `xcodebuild AL_BACKEND=HOSTED …` (README, "Demo build").
enum BackendTarget: Equatable {
    case local
    case hosted

    static var current: BackendTarget {
        #if AL_BACKEND_HOSTED
        .hosted
        #else
        .local
        #endif
    }
}

/// The hosted backend's address and Firebase client settings.
///
/// The Firebase settings stay out of the public repo: they go in the gitignored
/// `Config/Hosted.xcconfig` (copy `Config/Hosted.example.xcconfig`), and `Config/AppInfo.plist` passes
/// them into the app's Info.plist, where they are read at launch.
enum HostedBackend {
    /// The load balancer in front of al-ai and al-core (docs/deployment.md).
    static let apiBaseURL = "https://api.agentic-lender.com"

    /// Empty on a checkout without `Config/Hosted.xcconfig`; a hosted build then stops at launch and
    /// names the settings to fill in.
    static var firebase: HostedFirebase { HostedFirebase(info: Bundle.main.infoDictionary ?? [:]) }
}

/// The values from the hosted Firebase project's iOS app (its `GoogleService-Info.plist`): the four Firebase
/// settings, and the Google client ID and its reversed form for real Google sign-in (AL-320).
struct HostedFirebase: Equatable {
    let projectID: String
    let apiKey: String
    let appID: String
    let senderID: String
    /// `CLIENT_ID`: Google's sign-in reads it from the Info.plist key `GIDClientID`.
    let googleClientID: String
    /// `REVERSED_CLIENT_ID`: the URL scheme Google returns the borrower to the app with.
    let googleReversedClientID: String

    /// The Info.plist keys `Config/AppInfo.plist` fills from the build settings in `Config/Hosted.xcconfig`.
    enum Key {
        static let projectID = "ALFirebaseProjectID"
        static let apiKey = "ALFirebaseAPIKey"
        static let appID = "ALFirebaseAppID"
        static let senderID = "ALFirebaseSenderID"
        static let googleClientID = "GIDClientID"
        static let googleReversedClientID = "ALGoogleReversedClientID"
    }

    /// Reads the settings from the app's Info.plist; a key that is absent reads as blank.
    init(info: [String: Any]) {
        func value(_ key: String) -> String { info[key] as? String ?? "" }
        self.init(
            projectID: value(Key.projectID), apiKey: value(Key.apiKey), appID: value(Key.appID), senderID: value(Key.senderID),
            googleClientID: value(Key.googleClientID), googleReversedClientID: value(Key.googleReversedClientID)
        )
    }

    init(projectID: String, apiKey: String, appID: String, senderID: String, googleClientID: String, googleReversedClientID: String) {
        self.projectID = projectID
        self.apiKey = apiKey
        self.appID = appID
        self.senderID = senderID
        self.googleClientID = googleClientID
        self.googleReversedClientID = googleReversedClientID
    }

    /// The build settings still blank, by the name to set in `Config/Hosted.xcconfig`.
    var missing: [String] {
        [
            ("AL_FIREBASE_PROJECT_ID", projectID), ("AL_FIREBASE_API_KEY", apiKey),
            ("AL_FIREBASE_APP_ID", appID), ("AL_FIREBASE_SENDER_ID", senderID),
            // Google's sign-in raises an exception, not an error, without its client ID, so a hosted build needs both.
            ("AL_GOOGLE_CLIENT_ID", googleClientID), ("AL_GOOGLE_REVERSED_CLIENT_ID", googleReversedClientID),
        ]
        .filter { $0.1.trimmingCharacters(in: .whitespaces).isEmpty }
        .map(\.0)
    }
}
