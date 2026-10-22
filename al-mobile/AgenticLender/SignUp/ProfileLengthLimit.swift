/// The longest values al-core's `POST /core/me` accepts (app/me.py), checked before sending so a
/// borrower sees which field is too long instead of "couldn't be saved" (AL-240).
///
/// Counted on the value as it is sent (trimmed, the email in lower case) and in Unicode code points,
/// the way Python counts, so an accent typed separately counts as two.
struct ProfileLengthLimit {
    static let fullName = ProfileLengthLimit(maximum: 100)
    static let email = ProfileLengthLimit(maximum: 254)
    static let addressLine = ProfileLengthLimit(maximum: 200)

    let maximum: Int

    func error(for sentValue: String) -> String? {
        sentValue.unicodeScalars.count > maximum ? "Use \(maximum) characters or fewer" : nil
    }
}
