import SwiftUI

/// A switch between a few options, styled like the Figma segmented control
/// (Single / Joint on the affordability form, Employment on the application form).
struct SegmentedPicker<Value: Hashable>: View {
    /// The selected segment sits inset by this much inside the track (Figma frame "Affordability form").
    private static var inset: CGFloat { 3 }
    /// Each segment is a full tap target on its own, not counting the inset.
    private static var segmentHeight: CGFloat { Theme.minTapTarget }

    @Binding var selection: Value
    let options: [(value: Value, title: String)]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                segment(option.title, value: option.value)
            }
        }
        .padding(Self.inset)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
    }

    private func segment(_ title: String, value: Value) -> some View {
        let isSelected = selection == value
        return Button {
            selection = value
        } label: {
            Text(title)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? Theme.text : Theme.mutedText)
                .frame(maxWidth: .infinity, minHeight: Self.segmentHeight)
                .background(isSelected ? Theme.surface : .clear)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius - Self.inset))
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
