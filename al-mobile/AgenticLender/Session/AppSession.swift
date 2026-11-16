import Observation
import os

/// The saved login the app opens with, and signing out of it.
protocol SignedInState {
    var hasSignedInUser: Bool { get }
    func signOut() throws
    /// Calls `handler` whenever a signed-in user is signed out, including by Firebase itself when a token
    /// refresh finds the account deleted or disabled (AL-315).
    func onSignedOut(_ handler: @escaping @MainActor () -> Void)
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
    /// AL-295 and AL-315: the account behind the saved login is gone or disabled.
    static let sessionEndedMessage = "Your session has ended. Please sign in again."

    private(set) var start: Start
    /// Changes on every sign-out and return home; the navigation stack is keyed on it so it starts afresh.
    private(set) var stackID = 0
    private(set) var signOutError: String?
    /// Why the app signed the borrower out, shown on Welcome. Nil after an ordinary sign-out.
    private(set) var welcomeNotice: String?

    private let state: SignedInState
    /// Set while the app signs out itself, so Firebase reporting that sign-out isn't taken for an ended session.
    private var isSigningOut = false
    private let logger = Logger(category: "Session")

    init(state: SignedInState) {
        self.state = state
        start = state.hasSignedInUser ? .home : .welcome
        state.onSignedOut { [weak self] in self?.signedOutByFirebase() }
    }

    /// Firebase signed the borrower out on its own, on whatever screen they were (AL-315): back to Welcome
    /// with "Your session has ended", instead of that screen's Retry that can never work.
    private func signedOutByFirebase() {
        if isSigningOut {
            isSigningOut = false
            return
        }
        signOutError = nil
        welcomeNotice = Self.sessionEndedMessage
        start = .welcome
        stackID += 1
    }

    /// Signs out back to Welcome. `notice` says why, when the app signs the borrower out itself.
    func signOut(notice: String? = nil) {
        isSigningOut = true
        do {
            try state.signOut()
        } catch {
            isSigningOut = false
            logger.error("Signing out failed: \(error.localizedDescription, privacy: .public)")
            signOutError = Self.signOutFailedMessage
            return
        }
        signOutError = nil
        welcomeNotice = notice
        start = .welcome
        stackID += 1
    }

    /// Leaves a finished flow, such as a submitted application, for a fresh home screen.
    func returnHome() {
        start = .home
        stackID += 1
    }
}
