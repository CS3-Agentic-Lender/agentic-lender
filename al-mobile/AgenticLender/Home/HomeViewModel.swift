import Observation
import os

/// Drives the home screen's greeting with the borrower's first name.
@MainActor
@Observable
final class HomeViewModel {
    private(set) var firstName: String?
    private(set) var isLoading = true

    private let loadFullName: () async throws -> String
    private let logger = Logger(category: "Home")

    /// `loadFullName` reads the profile from al-core.
    init(loadFullName: @escaping () async throws -> String) {
        self.loadFullName = loadFullName
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

    static func firstName(from fullName: String) -> String? {
        fullName.split(whereSeparator: \.isWhitespace).first.map(String.init)
    }
}
