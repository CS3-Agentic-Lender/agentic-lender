/// Initials for a person's avatar, shared by the message thread's broker and the Profile screen.
enum PersonName {
    /// "BB" for Bob Byrne: the first letters of the first two names, or "?" without a name.
    static func initials(of name: String?) -> String {
        let letters = (name ?? "").split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}
