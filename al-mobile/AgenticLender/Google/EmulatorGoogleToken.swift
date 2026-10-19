import Foundation

#if DEBUG
/// A stand-in for a real Google sign-in while the app runs on the Auth emulator.
/// Debug builds only: it signs anyone in as any email, so it must never ship.
///
/// The emulator accepts an unsigned Google ID token, so no Google OAuth client is needed.
/// The deployed build will get its tokens from the Google Sign-In SDK instead; nothing
/// past `GoogleToken` changes when it does.
enum EmulatorGoogleToken {
    private static let subjectPrefix = "emulator-google-"

    /// The same email always gives the same Google account, so a returning user is recognised.
    static func make(email: String, name: String) -> GoogleToken {
        let normalizedEmail = Email.normalized(email)
        var claims: [String: Any] = [
            "sub": subjectPrefix + normalizedEmail,
            "email": normalizedEmail,
            "email_verified": true,
        ]
        if !name.isBlank { claims["name"] = name.trimmed }

        let header = base64URL(["alg": "none", "typ": "JWT"])
        return GoogleToken(idToken: "\(header).\(base64URL(claims)).", accessToken: "")
    }

    private static func base64URL(_ object: [String: Any]) -> String {
        // Only strings and a bool go in, which JSONSerialization always encodes.
        let data = (try? JSONSerialization.data(withJSONObject: object, options: .sortedKeys)) ?? Data()
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
#endif
