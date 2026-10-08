/// The borrower's profile as saved in Firestore at `users/{uid}`.
///
/// Built only from a form that passes `SignUpValidator`, so every value is already
/// cleaned up: trimmed text, lower-case email, phone in `+353` form, Eircode in capitals.
struct BorrowerProfile: Codable, Equatable {
    static let collection = "users"

    let uid: String
    let role: String
    let fullName: String
    let email: String
    let phone: String
    let addressLine1: String
    let addressLine2: String?
    let county: String
    let eircode: String

    init?(uid: String, form: SignUpForm) {
        guard SignUpValidator.errors(for: form).isEmpty,
              let phone = SignUpValidator.normalizedIrishPhone(form.phone),
              let eircode = SignUpValidator.normalizedEircode(form.eircode),
              let county = form.county
        else { return nil }

        self.uid = uid
        self.role = "borrower"
        self.fullName = form.fullName.trimmed
        self.email = form.email.trimmed.lowercased()
        self.phone = phone
        self.addressLine1 = form.addressLine1.trimmed
        self.addressLine2 = form.addressLine2.isBlank ? nil : form.addressLine2.trimmed
        self.county = county.name
        self.eircode = eircode
    }
}
