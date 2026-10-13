import Observation
import os

/// Drives the home screen: the greeting with the borrower's first name, and handing over to sign-out.
@MainActor
@Observable
final class HomeViewModel {
    private(set) var firstName: String?
    private(set) var isLoading = true

    private let loadFullName: () async throws -> String
    private let onSignOut: () -> Void
    private let logger = Logger(category: "Home")

    /// `loadFullName` reads the profile from al-core. `onSignOut` is supplied by whoever owns
    /// the sign-in state, so this screen only asks for it.
    init(loadFullName: @escaping () async throws -> String, onSignOut: @escaping () -> Void) {
        self.loadFullName = loadFullName
        self.onSignOut = onSignOut
    }

    /// "Hello, Aoife", or just "Hello" while the name loads or if it can't be read.
    var greeting: String {
        firstName.map { "Hello, \($0)" } ?? "Hello"
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            firstName = Self.firstName(from: try await loadFullName())
        } catch {
            // The name is a courtesy: everything else on home still works without it.
            logger.error("Loading the borrower's name failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func signOut() {
        onSignOut()
    }

    static func firstName(from fullName: String) -> String? {
        fullName.split(whereSeparator: \.isWhitespace).first.map(String.init)
    }
}
