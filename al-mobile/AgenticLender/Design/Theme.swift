import SwiftUI

/// Pine & Oat colour tokens, agreed for the app and the portal.
/// Source of truth: the design tokens table in docs/infrastructure.md.
enum Theme {
    static let pine = Color(hex: 0x1E342E)
    static let pinePressed = Color(hex: 0x142520)
    static let oat = Color(hex: 0xF6F4EE)
    static let surface = Color(hex: 0xFFFCF4)
    static let line = Color(hex: 0xD6DFD4)
    static let tint = Color(hex: 0xE8EFE7)
    static let neutral = Color(hex: 0xEEEBE3)
    static let text = Color(hex: 0x16241D)
    static let mutedText = Color(hex: 0x4C5851)
    static let success = Color(hex: 0x166534)
    static let error = Color(hex: 0x991B1B)

    static let cornerRadius: CGFloat = 10
    static let fieldHeight: CGFloat = 50
    static let screenPadding: CGFloat = 16
    /// Apple's minimum touch target.
    static let minTapTarget: CGFloat = 44
}

extension Color {
    /// A colour from a 0xRRGGBB literal.
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
