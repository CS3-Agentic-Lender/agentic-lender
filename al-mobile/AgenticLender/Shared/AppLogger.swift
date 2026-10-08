import os

extension Logger {
    private static let subsystem = "ie.mtu.agenticlender"

    /// A logger for one part of the app, under the app's subsystem.
    init(category: String) {
        self.init(subsystem: Self.subsystem, category: category)
    }
}
