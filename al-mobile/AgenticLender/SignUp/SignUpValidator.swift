import Foundation

/// Checks the sign-up form and returns one message per field that is wrong.
///
/// The password has to meet every `PasswordRule`.
enum SignUpValidator {
    static func errors(for form: SignUpForm) -> [SignUpField: String] {
        errors(for: form, fields: SignUpField.allCases)
    }

    static func errors(for form: SignUpForm, on step: SignUpStep) -> [SignUpField: String] {
        errors(for: form, fields: step.fields)
    }

    private static func errors(for form: SignUpForm, fields: [SignUpField]) -> [SignUpField: String] {
        Dictionary(uniqueKeysWithValues: fields.compactMap { field in
            error(for: field, in: form).map { (field, $0) }
        })
    }

    static func error(for field: SignUpField, in form: SignUpForm) -> String? {
        switch field {
        case .fullName:
            return form.fullName.isBlank ? "Enter your full name" : nil
        case .email:
            return Email.error(for: form.email)
        case .password:
            if form.password.isEmpty { return "Enter a password" }
            return PasswordRule.allMet(by: form.password)
                ? nil : "Use at least \(PasswordRule.requiredLength) characters, with a letter and a number"
        case .phone:
            if form.phone.isBlank { return "Enter your phone number" }
            return normalizedIrishPhone(form.phone) == nil
                ? "Enter an Irish phone number, like 087 123 4567" : nil
        case .addressLine1:
            return form.addressLine1.isBlank ? "Enter the first line of your address" : nil
        case .county:
            return form.county == nil ? "Choose your county" : nil
        case .eircode:
            if form.eircode.isBlank { return "Enter your Eircode" }
            return normalizedEircode(form.eircode) == nil ? "Enter an Eircode like A65 F4E2" : nil
        }
    }

    // MARK: - Irish phone

    /// Mobiles are 08x plus 7 digits; landlines are 0, an area code and the local number (7 to 9 digits after the 0).
    private static let irishNationalPattern = /^0(8[35679]\d{7}|[1-79]\d{6,8})$/
    private static let irishCountryCode = "+353"

    /// The number in international form (`+353871234567`), or nil if it isn't an Irish number.
    /// Accepts spaces, dashes and brackets, and a `+353` or `00353` prefix.
    static func normalizedIrishPhone(_ phone: String) -> String? {
        var digits = phone.filter { !" -()".contains($0) }
        for prefix in [irishCountryCode, "00353"] where digits.hasPrefix(prefix) {
            digits = "0" + digits.dropFirst(prefix.count)
        }
        guard digits.wholeMatch(of: irishNationalPattern) != nil else { return nil }
        return irishCountryCode + digits.dropFirst()
    }

    // MARK: - Eircode

    /// Routing key (a letter and two digits, or D6W) then a 4-character unique identifier,
    /// using only the letters Eircodes allow.
    private static let eircodePattern = /^([ACDEFHKNPRTVWXY]\d{2}|D6W)([0-9ACDEFHKNPRTVWXY]{4})$/

    /// The Eircode in capitals with one space (`A65 F4E2`), or nil if it isn't a valid Eircode.
    static func normalizedEircode(_ eircode: String) -> String? {
        let compact = eircode.uppercased().filter { !$0.isWhitespace }
        guard let match = compact.wholeMatch(of: eircodePattern) else { return nil }
        return "\(match.1) \(match.2)"
    }
}
