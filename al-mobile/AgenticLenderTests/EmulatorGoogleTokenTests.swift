import XCTest
@testable import AgenticLender

/// The unsigned Google ID token the Auth emulator accepts in place of a real Google sign-in.
final class EmulatorGoogleTokenTests: XCTestCase {
    private func claims(_ token: GoogleToken) throws -> [String: Any] {
        let parts = token.idToken.split(separator: ".", omittingEmptySubsequences: false)
        XCTAssertEqual(parts.count, 3, "header.payload.signature")
        XCTAssertEqual(parts[2], "", "the emulator token is unsigned")
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        let data = try XCTUnwrap(Data(base64Encoded: payload))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testCarriesTheTrimmedLowerCaseEmailAndName() throws {
        let token = EmulatorGoogleToken.make(email: " Aoife.Byrne@Gmail.com ", name: "Aoife Byrne")

        let claims = try claims(token)
        XCTAssertEqual(claims["email"] as? String, "aoife.byrne@gmail.com")
        XCTAssertEqual(claims["email_verified"] as? Bool, true)
        XCTAssertEqual(claims["name"] as? String, "Aoife Byrne")
    }

    func testSameEmailGivesTheSameGoogleAccountSoTheUserIsRecognisedNextTime() throws {
        let first = try claims(EmulatorGoogleToken.make(email: "aoife@gmail.com", name: "Aoife"))
        let again = try claims(EmulatorGoogleToken.make(email: "AOIFE@gmail.com ", name: "Aoife B"))
        let other = try claims(EmulatorGoogleToken.make(email: "ben@gmail.com", name: "Ben"))

        XCTAssertEqual(first["sub"] as? String, again["sub"] as? String)
        XCTAssertNotEqual(first["sub"] as? String, other["sub"] as? String)
    }

    func testLeavesOutAnEmptyName() throws {
        let claims = try claims(EmulatorGoogleToken.make(email: "aoife@gmail.com", name: "  "))

        XCTAssertNil(claims["name"])
    }
}
