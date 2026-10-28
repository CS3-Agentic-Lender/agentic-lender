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

/// A menu of the BER grades, in titled groups. `onPick` runs after each choice, so the form can
/// mark the field as left. F and G are on both scales, so in the property check they show twice.
struct BERMenu: View {
    @Binding var selection: BERRating?
    var groups = BERRating.affordabilityGroups
    var onPick: () -> Void = {}

    var body: some View {
        Menu {
            Picker("BER rating", selection: Binding(
                get: { selection },
                set: { selection = $0; onPick() }
            )) {
                ForEach(groups, id: \.self) { group in
                    Section {
                        ForEach(group.ratings) { rating in
                            Text(rating.title).tag(Optional(rating))
                        }
                    } header: {
                        if let title = group.title { Text(title) }
                    }
                }
            }
        } label: {
            PickerFieldLabel(value: selection?.title, placeholder: "Choose rating")
        }
        .accessibilityLabel("BER rating, \(selection?.title ?? "not chosen")")
    }
}

/// A menu of the home types. `onPick` runs after each choice, so the form can mark the field as left.
struct PropertyTypeMenu: View {
    @Binding var selection: PropertyType?
    var onPick: () -> Void = {}

    var body: some View {
        Menu {
            Picker("Property type", selection: Binding(
                get: { selection },
                set: { selection = $0; onPick() }
            )) {
                ForEach(PropertyType.allCases) { type in
                    Text(type.title).tag(Optional(type))
                }
            }
        } label: {
            PickerFieldLabel(value: selection?.title, placeholder: "Choose type")
        }
        .accessibilityLabel("Property type, \(selection?.title ?? "not chosen")")
    }
}

/// Bedrooms with − / + either side of the count (Figma 07i), "–" until one is chosen.
/// VoiceOver reads it as one adjustable element.
struct BedroomsStepper: View {
    let count: Int?
    let error: String?
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
                Text(count.map(String.init) ?? "–")
                    .font(.body.monospacedDigit())
                    .foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity)
                StepButton(systemImage: "plus", label: "More bedrooms", isEnabled: canIncrease, action: increase)
            }
            .frame(minHeight: Theme.fieldHeight)
            if let error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Bedrooms")
        .accessibilityValue(accessibilityValue)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: increase()
            case .decrement: decrease()
            @unknown default: break
            }
        }
    }

    private var accessibilityValue: String {
        let value = count.map(String.init) ?? "not chosen"
        return error.map { "\(value). Error: \($0)" } ?? value
    }
}
