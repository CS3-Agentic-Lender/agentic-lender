import SwiftUI

/// The text and chevron inside a picker field, such as County or BER rating (Figma 07i and 12).
/// Shows the placeholder in muted text until something is chosen.
struct PickerFieldLabel: View {
    let value: String?
    let placeholder: String

    var body: some View {
        HStack {
            Text(value ?? placeholder)
                .foregroundStyle(value == nil ? Theme.mutedText : Theme.text)
            Spacer()
            Image(systemName: "chevron.down")
                .foregroundStyle(Theme.mutedText)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
        .contentShape(Rectangle())
    }
}

/// A menu of the BER grades. `onPick` runs after each choice, so the form can mark the field as left.
struct BERMenu: View {
    @Binding var selection: BERRating?
    var onPick: () -> Void = {}

    var body: some View {
        Menu {
            Picker("BER rating", selection: Binding(
                get: { selection },
                set: { selection = $0; onPick() }
            )) {
                ForEach(BERRating.allCases) { rating in
                    Text(rating.title).tag(Optional(rating))
                }
            }
        } label: {
            PickerFieldLabel(value: selection?.title, placeholder: "Choose rating")
        }
        .accessibilityLabel("BER rating, \(selection?.title ?? "not chosen")")
    }
}

/// Bedrooms with − / + either side of the count (Figma 07i). VoiceOver reads it as one adjustable element.
struct BedroomsStepper: View {
    let count: Int
    let canDecrease: Bool
    let canIncrease: Bool
    let decrease: () -> Void
    let increase: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Bedrooms")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.text)
            HStack {
                StepButton(systemImage: "minus", label: "Fewer bedrooms", isEnabled: canDecrease, action: decrease)
                Text("\(count)")
                    .font(.body.monospacedDigit())
                    .foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity)
                StepButton(systemImage: "plus", label: "More bedrooms", isEnabled: canIncrease, action: increase)
            }
            .frame(minHeight: Theme.fieldHeight)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Bedrooms")
        .accessibilityValue("\(count)")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: increase()
            case .decrement: decrease()
            @unknown default: break
            }
        }
    }
}
