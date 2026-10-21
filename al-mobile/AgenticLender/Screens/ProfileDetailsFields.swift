import SwiftUI

/// Phone, address, county and Eircode: step 2 of sign-up (Figma 05 to 05a) and the profile
/// screen of a first-time Google user (Figma 05b).
struct ProfileDetailsFields: View {
    @Binding var form: SignUpForm
    let error: (SignUpField) -> String?
    var focus: FocusState<SignUpField?>.Binding
    let isDisabled: Bool
    let chooseCounty: () -> Void
    /// Starts each accessibility ID, so the two screens using these fields can be told apart.
    let idPrefix: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            FormField("Phone", error: error(.phone), isDisabled: isDisabled) {
                TextField("087 123 4567", text: $form.phone)
                    .textContentType(.telephoneNumber)
                    .keyboardType(.phonePad)
                    .focused(focus, equals: .phone)
                    .accessibilityIdentifier("\(idPrefix).phone")
            }
            FormField("Address line 1", error: error(.addressLine1), isDisabled: isDisabled) {
                TextField("Address line 1", text: $form.addressLine1)
                    .textContentType(.streetAddressLine1)
                    .focused(focus, equals: .addressLine1)
                    .accessibilityIdentifier("\(idPrefix).addressLine1")
            }
            FormField("Address line 2 (optional)", error: nil, isDisabled: isDisabled) {
                TextField("Apartment, estate or area", text: $form.addressLine2)
                    .textContentType(.streetAddressLine2)
                    .accessibilityIdentifier("\(idPrefix).addressLine2")
            }
            FormField("County", error: error(.county), isDisabled: isDisabled) {
                countyButton
            }
            FormField("Eircode", error: error(.eircode), isDisabled: isDisabled) {
                TextField("A65 F4E2", text: $form.eircode)
                    .textContentType(.postalCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused(focus, equals: .eircode)
                    .accessibilityIdentifier("\(idPrefix).eircode")
            }
        }
        .disabled(isDisabled)
    }

    private var countyButton: some View {
        Button {
            focus.wrappedValue = nil
            chooseCounty()
        } label: {
            HStack {
                Text(form.county?.name ?? "Choose county")
                    .foregroundStyle(form.county == nil ? Theme.mutedText : Theme.text)
                Spacer()
                Image(systemName: "chevron.down").foregroundStyle(Theme.mutedText)
            }
            .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("County, \(form.county?.name ?? "not chosen")")
        .accessibilityIdentifier("\(idPrefix).county")
    }
}
