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
        .buttonStyle(PineButtonStyle())
        .disabled(isLoading || !isEnabled)
    }
}

/// Pine when enabled; muted Line and Muted text when disabled (Figma frame 04).
private struct PineButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isEnabled ? Theme.surface : Theme.mutedText)
            .background(background(isPressed: configuration.isPressed))
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
    }

    private func background(isPressed: Bool) -> Color {
        guard isEnabled else { return Theme.line }
        return isPressed ? Theme.pinePressed : Theme.pine
    }
}
