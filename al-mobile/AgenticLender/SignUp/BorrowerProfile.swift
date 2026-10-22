import Foundation

/// The borrower's profile as sent to `POST /core/me` (AL-220), which saves it to `users/{uid}`.
///
/// Built only from a form whose profile fields pass `SignUpValidator`, so every value is already
/// cleaned up: trimmed text, lower-case email, phone in `+353` form, Eircode in capitals.
/// The password isn't checked here: it isn't part of the profile, and a Google user has none.
/// There is no uid or role: the API takes the uid from the ID token and sets the role itself.
struct BorrowerProfile: Encodable, Equatable {
    let fullName: String
    let email: String
    let phone: String
    let addressLine1: String
    let addressLine2: String?
    let county: String
    let eircode: String

    /// The field names agreed with Dumi on AL-220. Spelled out because the automatic
    /// snake_case conversion would turn `addressLine1` into `address_line1`.
    private enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case email
        case phone
        case addressLine1 = "address_line_1"
        case addressLine2 = "address_line_2"
        case county
        case eircode
    }

    /// Nil unless every profile field passes, including the /core/me length limits, so a profile that al-core
    /// would refuse is never built.
    init?(form: SignUpForm) {
        guard SignUpValidator.errors(for: form, fields: SignUpValidator.profileFields).isEmpty,
              let phone = SignUpValidator.normalizedIrishPhone(form.phone),
              let eircode = SignUpValidator.normalizedEircode(form.eircode),
              let county = form.county
        else { return nil }

        self.fullName = form.fullName.trimmed
        self.email = Email.normalized(form.email)
        self.phone = phone
        self.addressLine1 = form.addressLine1.trimmed
        self.addressLine2 = form.addressLine2.isBlank ? nil : form.addressLine2.trimmed
        self.county = county.name
        self.eircode = eircode
    }

    /// The JSON body for `POST /core/me`; an empty second address line is left out.
    func body() throws -> Data {
        try JSONEncoder().encode(self)
    }
}
