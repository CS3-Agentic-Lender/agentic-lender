/// Email addresses as the borrower types them: checked and cleaned up the same way
/// everywhere (sign-up, sign-in and password reset).
enum Email {
    private static let pattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

    static func isValid(_ email: String) -> Bool {
        email.trimmed.wholeMatch(of: pattern) != nil
    }

    /// Trimmed and lower case, as Firebase Auth and the profile store it.
    static func normalized(_ email: String) -> String {
        email.trimmed.lowercased()
    }

    /// The message to show under an email field, or nil if the email is fine.
    static func error(for email: String) -> String? {
        if email.isBlank { return "Enter your email" }
        return isValid(email) ? nil : "Enter an email like name@example.com"
    }
}
