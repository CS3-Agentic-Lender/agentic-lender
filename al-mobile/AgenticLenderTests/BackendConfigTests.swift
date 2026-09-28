import XCTest
@testable import AgenticLender

final class BackendConfigTests: XCTestCase {
    func testUsesLocalhostWhenNoHostIsSet() {
        let config = BackendConfig(environment: [:])

        XCTAssertEqual(config.emulatorHost, "localhost")
    }

    func testUsesEmulatorHostFromEnvironment() {
        let config = BackendConfig(environment: ["EMULATOR_HOST": "192.168.1.20"])

        XCTAssertEqual(config.emulatorHost, "192.168.1.20")
    }

    func testFallsBackToLocalhostWhenHostIsBlank() {
        let config = BackendConfig(environment: ["EMULATOR_HOST": "  "])

        XCTAssertEqual(config.emulatorHost, "localhost")
    }

    func testPortsMatchTheFirebaseEmulatorConfig() {
        // Must match al-core/firebase.json.
        XCTAssertEqual(BackendConfig.authEmulatorPort, 9099)
        XCTAssertEqual(BackendConfig.firestoreEmulatorPort, 8080)
    }
}
