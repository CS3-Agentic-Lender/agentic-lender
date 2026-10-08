import Foundation

/// Whole-euro amounts as the borrower types them: "60,000", "€ 60000" or "60000".
enum EuroAmount {
    private static let locale = Locale(identifier: "en_IE")

    /// The amount in whole euro, or nil if the text isn't a whole amount of €0 or more.
    static func parse(_ text: String) -> Int? {
        let digits = stripped(text)
        guard !digits.isEmpty, digits.allSatisfy(\.isASCIIDigit) else { return nil }
        return Int(digits)
    }

    /// "60000" → "60,000".
    static func format(_ amount: Int) -> String {
        amount.formatted(.number.grouping(.automatic).locale(locale))
    }

    /// Regroups the thousands separators while the borrower types.
    /// Text that isn't only digits is left as typed, so its error can show.
    static func regroup(_ text: String) -> String {
        let digits = stripped(text)
        guard !digits.isEmpty else { return "" }
        guard let amount = parse(digits) else { return text }
        return format(amount)
    }

    private static func stripped(_ text: String) -> String {
        text.filter { !$0.isWhitespace && $0 != "," && $0 != "€" }
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
