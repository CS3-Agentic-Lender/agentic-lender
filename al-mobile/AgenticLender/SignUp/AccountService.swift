/// A sign-up that has passed validation, ready to send to Firebase.
struct NewAccount: Equatable {
    let form: SignUpForm

    var email: String { form.email.trimmed.lowercased() }
    var password: String { form.password }

    /// The Firestore profile for this account once Firebase Auth has given it a uid.
    func profile(uid: String) -> BorrowerProfile? {
        BorrowerProfile(uid: uid, form: form)
    }
}

/// Creates a borrower's login and profile.
protocol AccountService: Sendable {
    /// Creates the account and saves its profile, returning the new uid.
    func createAccount(_ account: NewAccount) async throws -> String
}

/// Why an account couldn't be created, with a message the borrower can act on.
enum AccountError: Error, Equatable {
    case emailAlreadyInUse
    case invalidEmail
    case weakPassword
    case network
    case profileNotSaved
    case unknown

    var message: String {
        switch self {
        case .emailAlreadyInUse:
            "An account already uses this email. Sign in instead."
        case .invalidEmail:
            "Enter an email like name@example.com"
        case .weakPassword:
            "Choose a stronger password."
        case .network:
            "Can't reach the server. Check your connection and try again."
        case .profileNotSaved:
            "Your details couldn't be saved. Try again."
        case .unknown:
            "Something went wrong creating your account. Try again."
        }
    }
}
