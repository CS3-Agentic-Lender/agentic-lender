import SwiftUI

/// A whole-number field that shows the amount regrouped as the borrower types: "2,100,000", and
/// "210,000" after deleting a digit (AL-250).
///
/// A `TextField` bound straight to a value that its setter rewrites isn't redrawn while it's being
/// edited, so the old separators stayed on screen. This field keeps its own text and, after each edit,
/// writes the regrouped text back on the next turn of the main loop, which SwiftUI does redraw. The model still gets
/// every edit through `onEdit`, and a change from outside (such as a saved check filling the form)
/// replaces what is shown.
///
/// The model's own regrouped copy of an edit is not written back (AL-286). When typing fast it can arrive
/// while the keystroke is still being applied, so the screen kept the old text, and the regroup on the
/// next turn then had nothing left to change.
struct AmountTextField: View {
    let placeholder: String
    /// The model's text for this field.
    let text: String
    /// Called with each edit as typed; the model regroups and stores it.
    let onEdit: (String) -> Void

    @State private var shown = ""

    var body: some View {
        TextField(placeholder, text: $shown)
            .onAppear { shown = text }
            .onChange(of: shown) { _, typed in
                onEdit(typed)
                let regrouped = EuroAmount.regroup(typed)
                guard regrouped != typed else { return }
                // On the next turn of the main loop: a change made while the field is still applying the
                // keystroke is dropped.
                DispatchQueue.main.async {
                    if EuroAmount.regroup(shown) == regrouped { shown = regrouped }
                }
            }
            .onChange(of: text) { _, stored in
                if Self.replacesShown(shown, with: stored) { shown = stored }
            }
    }

    /// Whether the model's text should replace what is shown: only when it isn't just what is shown, regrouped.
    static func replacesShown(_ shown: String, with stored: String) -> Bool {
        stored != shown && stored != EuroAmount.regroup(shown)
    }
}
