import SwiftUI

extension StatusTone {
    /// Background and text for a badge in this tone (palette A, docs/infrastructure.md).
    var colors: (background: Color, text: Color) {
        switch self {
        case .neutral: (Theme.neutral, Theme.neutralBadgeText)
        case .tint: (Theme.tint, Theme.pine)
        case .success: (Theme.successBadge, Theme.success)
        case .danger: (Theme.dangerBadge, Theme.error)
        }
    }
}

/// A status badge like the portal's: always the status as text, never colour alone.
struct StatusBadge: View {
    let text: String
    let tone: StatusTone

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tone.colors.text)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(tone.colors.background)
            .clipShape(Capsule())
    }
}
