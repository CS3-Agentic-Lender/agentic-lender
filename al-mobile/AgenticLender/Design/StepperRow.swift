import SwiftUI

/// A label with its value and − / + buttons, such as "Term · 30 years" (Figma "Affordability form" and 12).
/// VoiceOver reads it as one adjustable element.
struct StepperRow: View {
    let label: String
    let value: String
    let decreaseLabel: String
    let increaseLabel: String
    let canDecrease: Bool
    let canIncrease: Bool
    let decrease: () -> Void
    let increase: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline.weight(.medium)).foregroundStyle(Theme.text)
                Text(value)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Theme.text)
            }
            Spacer()
            StepButton(systemImage: "minus", label: decreaseLabel, isEnabled: canDecrease, action: decrease)
            StepButton(systemImage: "plus", label: increaseLabel, isEnabled: canIncrease, action: increase)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(value)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: increase()
            case .decrement: decrease()
            @unknown default: break
            }
        }
    }
}

/// A square − / + button at the minimum tap target size.
private struct StepButton: View {
    let systemImage: String
    let label: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.headline)
                .frame(width: Theme.minTapTarget, height: Theme.minTapTarget)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.line))
        }
        .foregroundStyle(isEnabled ? Theme.text : Theme.mutedText)
        .disabled(!isEnabled)
        .accessibilityLabel(label)
    }
}
