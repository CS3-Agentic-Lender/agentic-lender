import GoogleSignIn
import UIKit

/// Google's own sign-in screen, for the hosted build (AL-320). It reads the client ID from the Info.plist key
/// `GIDClientID` (Config/AppInfo.plist, filled from the gitignored Config/Hosted.xcconfig) and returns to the app
/// through the reversed client ID URL scheme, which `AgenticLenderApp` hands back with `GIDSignIn.handle`.
@MainActor
struct SDKGoogleTokenSource: GoogleTokenSource {
    struct NoScreenToPresentOn: Error {}
    struct NoIDToken: Error {}

    func token() async throws -> GoogleToken? {
        guard let presenter = Self.topViewController() else { throw NoScreenToPresentOn() }
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let idToken = result.user.idToken?.tokenString else { throw NoIDToken() }
            return GoogleToken(idToken: idToken, accessToken: result.user.accessToken.tokenString)
        } catch GIDSignInError.canceled {
            return nil  // the borrower closed Google's screen: back to Welcome, no error
        }
    }

    /// The screen on top, which Google's sign-in is presented over.
    private static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
