import XCTest
@testable import AgenticLender

/// The demo build switch: the `AL_BACKEND` build setting points the app at the local emulators
/// and gateway (`LOCAL`, the default) or the hosted Firebase project and API (`HOSTED`).
final class BackendTargetTests: XCTestCase {
    private let complete = HostedFirebase(
        projectID: "al-demo", apiKey: "key", appID: "1:2:ios:3", senderID: "2",
        googleClientID: "2-abc.apps.googleusercontent.com", googleReversedClientID: "com.googleusercontent.apps.2-abc"
    )

    // MARK: - The API address

    func testAnOrdinaryBuildIsLocal() {
        XCTAssertEqual(BackendTarget.current, .local, "unit tests run on a build without AL_BACKEND=HOSTED")
    }

    func testAHostedBuildCallsTheDeployedAPI() {
        let config = BackendConfig(environment: [:], target: .hosted)

        XCTAssertEqual(config.apiBaseURL.absoluteString, "https://api.agentic-lender.com")
    }

    func testAHostedBuildIgnoresTheEmulatorHost() {
        let config = BackendConfig(environment: ["EMULATOR_HOST": "192.168.1.20"], target: .hosted)

        XCTAssertEqual(config.apiBaseURL.absoluteString, "https://api.agentic-lender.com")
    }

    func testALocalBuildStillCallsTheLocalGateway() {
        let config = BackendConfig(environment: ["EMULATOR_HOST": "192.168.1.20"], target: .local)

        XCTAssertEqual(config.apiBaseURL.absoluteString, "http://192.168.1.20:8000")
    }

    // MARK: - Firebase

    func testALocalBuildUsesTheEmulators() {
        let plan = FirebaseSetup.plan(for: BackendConfig(environment: ["EMULATOR_HOST": "mac.local"], target: .local))

        XCTAssertEqual(plan, .emulators(host: "mac.local"))
    }

    func testAHostedBuildUsesTheHostedProject() {
        let plan = FirebaseSetup.plan(for: BackendConfig(environment: [:], target: .hosted), hosted: complete)

        XCTAssertEqual(plan, .hosted(complete))
    }

    func testAHostedBuildNamesEveryMissingFirebaseSetting() {
        let partial = HostedFirebase(
            projectID: "al-demo", apiKey: " ", appID: "", senderID: "2",
            googleClientID: "2-abc.apps.googleusercontent.com", googleReversedClientID: ""
        )

        let plan = FirebaseSetup.plan(for: BackendConfig(environment: [:], target: .hosted), hosted: partial)

        XCTAssertEqual(plan, .missing(["AL_FIREBASE_API_KEY", "AL_FIREBASE_APP_ID", "AL_GOOGLE_REVERSED_CLIENT_ID"]))
    }

    // MARK: - Reading the hosted settings (gitignored Config/Hosted.xcconfig, through Info.plist)

    func testTheHostedSettingsAreReadFromTheAppsInfoPlist() {
        let info: [String: Any] = [
            "ALFirebaseProjectID": "al-demo",
            "ALFirebaseAPIKey": "key",
            "ALFirebaseAppID": "1:2:ios:3",
            "ALFirebaseSenderID": "2",
            "GIDClientID": "2-abc.apps.googleusercontent.com",
            "ALGoogleReversedClientID": "com.googleusercontent.apps.2-abc",
        ]

        XCTAssertEqual(HostedFirebase(info: info), complete)
    }

    func testSettingsMissingFromInfoPlistAreNamedByTheirBuildSetting() {
        // An ordinary checkout has no Config/Hosted.xcconfig, so the settings arrive empty or not at all.
        let info: [String: Any] = ["ALFirebaseProjectID": "al-demo", "ALFirebaseAPIKey": ""]

        XCTAssertEqual(HostedFirebase(info: info).missing, [
            "AL_FIREBASE_API_KEY", "AL_FIREBASE_APP_ID", "AL_FIREBASE_SENDER_ID",
            "AL_GOOGLE_CLIENT_ID", "AL_GOOGLE_REVERSED_CLIENT_ID",
        ])
    }
}
