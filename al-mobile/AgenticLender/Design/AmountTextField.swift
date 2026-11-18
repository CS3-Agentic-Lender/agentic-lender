import SwiftUI
import UIKit

/// A whole-number field that shows the amount regrouped as the borrower types: "2,100,000", and
/// "210,000" after deleting a digit (AL-250).
///
/// It is a UIKit text field (AL-318): each keystroke is applied and regrouped in the same step, with the
/// cursor kept after the same digits, so there is no later write for SwiftUI to drop while typing fast. The
/// model gets every edit through `onEdit`, and a change from outside (such as a saved check filling the
/// form) replaces what is shown. SwiftUI's `.focused` doesn't reach a UIKit field, so the form learns that the
/// borrower left it through `onEndEditing`, and screens that put the keyboard away also call `Keyboard.dismiss()`.
struct AmountTextField: UIViewRepresentable {
    let placeholder: String
    /// The model's text for this field.
    let text: String
    /// Called with each edit, already regrouped; the model stores it.
    let onEdit: (String) -> Void
    /// Called when the borrower leaves the field, so the form can mark it touched and show its error.
    let onEndEditing: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onEdit: onEdit, onEndEditing: onEndEditing) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.keyboardType = .numberPad
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.textColor = UIColor(Theme.text)
        field.placeholder = placeholder
        field.text = text
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.onEdit = onEdit
        context.coordinator.onEndEditing = onEndEditing
        field.placeholder = placeholder
        if Self.replacesShown(field.text ?? "", with: text) { field.text = text }
    }

    /// Whether the model's text should replace what is shown: only when it isn't just what is shown, regrouped.
    static func replacesShown(_ shown: String, with stored: String) -> Bool {
        stored != shown && stored != EuroAmount.regroup(shown)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var onEdit: (String) -> Void
        var onEndEditing: () -> Void

        init(onEdit: @escaping (String) -> Void, onEndEditing: @escaping () -> Void) {
            self.onEdit = onEdit
            self.onEndEditing = onEndEditing
        }

        func textFieldDidEndEditing(_ field: UITextField) {
            onEndEditing()
        }

        /// Applies the keystroke here, regrouped, instead of letting UIKit apply it as typed.
        func textField(_ field: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            let edit = EuroAmount.edit(field.text ?? "", replacing: range, with: string)
            field.text = edit.text
            if let caret = field.position(from: field.beginningOfDocument, offset: edit.caret) {
                field.selectedTextRange = field.textRange(from: caret, to: caret)
            }
            onEdit(edit.text)
            return false
        }
    }
}

/// Puts the keyboard away, including for UIKit fields that SwiftUI's `.focused` doesn't reach.
enum Keyboard {
    @MainActor
    static func dismiss() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
