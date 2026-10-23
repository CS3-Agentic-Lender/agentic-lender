import Observation
import os

/// The saved login the app opens with, and signing out of it.
protocol SignedInState {
    var hasSignedInUser: Bool { get }
    func signOut() throws
}

/// Which screen the app opens on, and signing out back to Welcome.
///
/// Firebase Auth keeps the login between launches, so a borrower who signed in before
/// opens straight on home. Signing in or up from Welcome pushes home onto Welcome's stack
/// instead, so signing out always rebuilds the stack from its first screen.
@MainActor
@Observable
final class AppSession {
    enum Start: Equatable {
        case welcome
        case home
    }

    static let signOutFailedMessage = "Couldn't sign out. Try again."

    private(set) var start: Start
    /// Changes on every sign-out and return home; the navigation stack is keyed on it so it starts afresh.
    private(set) var stackID = 0
    private(set) var signOutError: String?

    private let state: SignedInState
    private let logger = Logger(category: "Session")

    init(state: SignedInState) {
        self.state = state
        start = state.hasSignedInUser ? .home : .welcome
    }

    func signOut() {
        do {
            try state.signOut()
        } catch {
            logger.error("Signing out failed: \(error.localizedDescription, privacy: .public)")
            signOutError = Self.signOutFailedMessage
            return
        }
        signOutError = nil
        start = .welcome
        stackID += 1
    }

    /// Leaves a finished flow, such as a submitted application, for a fresh home screen.
    func returnHome() {
        start = .home
        stackID += 1
    }
}
