import FirebaseAuth
import os

/// What the UI tests (`AgenticLenderUITests`) can ask of a launch. Debug builds only.
///
/// Firebase keeps the login in the keychain, so without this a test would open on the home of
/// whoever the last test signed in as.
enum UITestLaunch {
    /// Set to "1" to start signed out.
    static let signOutKey = "AL_UI_TEST_SIGN_OUT"

    private static let logger = Logger(category: "UITest")

    /// Call after `FirebaseSetup.configure()` and before the session reads the saved login.
    static func apply(environment: [String: String] = ProcessInfo.processInfo.environment) {
        #if DEBUG
        guard environment[signOutKey] == "1" else { return }
        do {
            try Auth.auth().signOut()
        } catch {
            logger.error("UI test sign-out failed: \(error.localizedDescription, privacy: .public)")
        }
        #endif
    }
}
