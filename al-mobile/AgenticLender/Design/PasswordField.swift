import SwiftUI

/// A password text field with a show/hide button, used inside a `FormField`.
/// Callers add `.submitLabel` and `.onSubmit` around it as with any text field.
struct PasswordField<Field: Hashable>: View {
    @Binding var text: String
    let contentType: UITextContentType
    let focus: FocusState<Field?>.Binding
    let field: Field
    let identifier: String
    @State private var isVisible = false

    var body: some View {
        HStack {
            Group {
                if isVisible {
                    TextField("Password", text: $text)
                } else {
                    SecureField("Password", text: $text)
                }
            }
            .textContentType(contentType)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused(focus, equals: field)
            .accessibilityIdentifier(identifier)

            Button {
                isVisible.toggle()
            } label: {
                Image(systemName: isVisible ? "eye.slash" : "eye")
                    .frame(width: 44, height: 44)
            }
            .foregroundStyle(Theme.mutedText)
            .accessibilityLabel(isVisible ? "Hide password" : "Show password") // betterleaks:allow — button label, not a secret
        }
    }
}
