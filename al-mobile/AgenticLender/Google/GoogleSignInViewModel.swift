import Observation
import os

/// Drives "Continue with Google" on the sign-in and sign-up screens.
@MainActor
@Observable
final class GoogleSignInViewModel {
    enum Destination: Hashable {
        case home
        case profile(GoogleUser)
    }

    private(set) var destination: Destination?
    private(set) var errorMessage: String?
    private(set) var isWorking = false

    private let service: GoogleSignInService
    private let logger = Logger(category: "GoogleSignIn")

    static let failureMessage = "Something went wrong signing in with Google. Try again."

    init(service: GoogleSignInService) {
        self.service = service
    }

    /// Called when the borrower comes back from where Google sign-in led, so it can start again.
    func leaveDestination() {
        destination = nil
    }

    func continueWithGoogle(_ token: GoogleToken) async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }
        do {
            switch try await service.signIn(with: token) {
            case .signedIn: destination = .home
            case .needsProfile(let user): destination = .profile(user)
            }
        } catch AccountError.network {
            errorMessage = CommonMessage.cantReachServer
        } catch {
            logger.error("Google sign-in failed: \(error.localizedDescription, privacy: .public)")
            errorMessage = Self.failureMessage
        }
    }
}
