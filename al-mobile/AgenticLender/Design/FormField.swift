import SwiftUI

/// A labelled form row with its error message underneath, styled with the Pine & Oat tokens.
struct FormField<Content: View>: View {
    let label: String
    let error: String?
    let isDisabled: Bool
    @ViewBuilder let content: Content

    init(_ label: String, error: String?, isDisabled: Bool = false, @ViewBuilder content: () -> Content) {
        self.label = label
        self.error = error
        self.isDisabled = isDisabled
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.text)

            content
                .padding(.horizontal, 16)
                .frame(minHeight: Theme.fieldHeight)
                .background(isDisabled ? Theme.neutral : Theme.surface)
                .foregroundStyle(isDisabled ? Theme.mutedText : Theme.text)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.cornerRadius)
                        .stroke(error == nil ? Theme.line : Theme.error, lineWidth: error == nil ? 1 : 2)
                )

            if let error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .accessibilityLabel("Error: \(error)")
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// The full-width Pine button at the bottom of a form step.
struct PrimaryButton: View {
    let title: String
    var isLoading = false
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView().tint(Theme.surface)
                }
                Text(title).font(.headline)
            }
            .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
        }
        .buttonStyle(PineButtonStyle(isLoading: isLoading))
        .disabled(isLoading || !isEnabled)
    }

    /// Pine when it can be tapped or is working; Line with Muted text when disabled (Figma frame 04).
    /// A loading button is disabled too, but stays Pine so its Surface spinner shows.
    static func colours(isEnabled: Bool, isLoading: Bool, isPressed: Bool) -> (background: Color, foreground: Color) {
        guard isEnabled || isLoading else { return (Theme.line, Theme.mutedText) }
        return (isPressed ? Theme.pinePressed : Theme.pine, Theme.surface)
    }
}

private struct PineButtonStyle: ButtonStyle {
    let isLoading: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let colours = PrimaryButton.colours(isEnabled: isEnabled, isLoading: isLoading, isPressed: configuration.isPressed)
        return configuration.label
            .foregroundStyle(colours.foreground)
            .background(colours.background)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
    }
}
