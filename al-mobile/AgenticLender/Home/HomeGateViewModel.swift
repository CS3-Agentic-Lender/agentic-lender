import Observation
import os

/// Decides what a signed-in borrower sees first: the broker picker if they have no broker yet,
/// otherwise home. Every route to home goes through it, so no borrower reaches home without one.
@MainActor
@Observable
final class HomeGateViewModel {
    enum State: Equatable {
        case loading
        case chooseBroker
        case home(CoreProfile)
        /// Signed in with no profile yet (an interrupted sign-up): fill in "Your details" first.
        case needsDetails(GoogleUser)
        /// The profile couldn't load, so it isn't known whether a broker is chosen; Retry tries again.
        case failed(String)
        /// The account can't go any further, so the borrower is signed out and Welcome shows the
        /// message, rather than a Retry that fails the same way every time.
        case mustSignOut(String)
    }

    static let loadFailedMessage = "Couldn't load your details. Try again."
    /// AL-258: with no email, a profile can't be saved, so "Your details" can't help.
    static let noEmailMessage = "This account has no email address. Please sign in with email or Google."
    /// AL-295: the saved login's account was deleted or disabled.
    static let sessionEndedMessage = AccountError.sessionEnded.message

    private(set) var state = State.loading

    private let service: ProfileService
    private let logger = Logger(category: "Home")

    init(service: ProfileService) {
        self.service = service
    }

    func load() async {
        state = .loading
        do {
            let profile = try await service.loadProfile()
            state = profile.needsBroker ? .chooseBroker : .home(profile)
        } catch {
            if error as? AccountError == .sessionEnded {
                state = .mustSignOut(Self.sessionEndedMessage)
                return
            }
            if error as? AccountError == .noProfile {
                // `signedInUser` is nil when Firebase's user has no email.
                state = service.signedInUser.map(State.needsDetails) ?? .mustSignOut(Self.noEmailMessage)
                return
            }
            logger.error("Loading the profile failed: \(error.localizedDescription, privacy: .public)")
            state = .failed(error as? AccountError == .network ? CommonMessage.cantReachServer : Self.loadFailedMessage)
        }
    }

    func brokerChosen(_ profile: CoreProfile) {
        state = .home(profile)
    }
}
