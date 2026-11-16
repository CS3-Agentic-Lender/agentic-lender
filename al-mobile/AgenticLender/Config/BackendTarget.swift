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

/// The hosted backend's addresses and Firebase client settings. These identify the project rather
/// than grant access (Firebase's security rules and al-core's token check do that), so they live in
/// the code like the emulator ports.
enum HostedBackend {
    /// The load balancer in front of al-ai and al-core (docs/deployment.md).
    static let apiBaseURL = "https://api.agentic-lender.com"

    /// Empty until the iOS app is registered in the hosted Firebase project; a hosted build stops at
    /// launch and names what's missing until then.
    static let firebase = HostedFirebase(projectID: "", apiKey: "", appID: "", senderID: "")
}

/// The four values from the hosted Firebase project's iOS app (its `GoogleService-Info.plist`).
struct HostedFirebase: Equatable {
    let projectID: String
    let apiKey: String
    let appID: String
    let senderID: String

    /// The names of the settings that are still blank.
    var missing: [String] {
        [("projectID", projectID), ("apiKey", apiKey), ("appID", appID), ("senderID", senderID)]
            .filter { $0.1.trimmingCharacters(in: .whitespaces).isEmpty }
            .map(\.0)
    }
}
