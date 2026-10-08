/// What the borrower has typed into the two sign-up steps, exactly as typed.
struct SignUpForm: Equatable {
    var fullName = ""
    var email = ""
    var password = ""
    var phone = ""
    var addressLine1 = ""
    var addressLine2 = ""
    var county: County?
    var eircode = ""
}

/// The two screens of sign-up: Figma frame 04 (account) and frames 05 to 05d (details).
enum SignUpStep: Equatable {
    case account
    case details

    var fields: [SignUpField] {
        switch self {
        case .account: [.fullName, .email, .password]
        case .details: [.phone, .addressLine1, .county, .eircode]
        }
    }
}

/// Every field that can show an error. Address line 2 is optional, so it never does.
enum SignUpField: CaseIterable, Hashable {
    case fullName
    case email
    case password
    case phone
    case addressLine1
    case county
    case eircode
}
