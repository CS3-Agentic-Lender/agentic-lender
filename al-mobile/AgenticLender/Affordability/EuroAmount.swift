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

    /// The field's text after one edit, and where the cursor goes (in UTF-16 units, as UIKit counts).
    struct Edit: Equatable {
        let text: String
        let caret: Int
    }

    /// Applies one keystroke or paste to `text` and regroups it at once (AL-318), keeping the cursor after the
    /// same number of digits as before. A backspace on a separator deletes the digit before it, since the
    /// separator alone would come straight back.
    static func edit(_ text: String, replacing range: NSRange, with replacement: String) -> Edit {
        let current = text as NSString
        var range = range
        let removesOnlySeparators = replacement.isEmpty && range.length > 0
            && !current.substring(with: range).contains(where: \.isASCIIDigit)
        if removesOnlySeparators, let digit = lastDigit(in: current, before: range.location) {
            range = NSRange(location: digit, length: range.location + range.length - digit)
        }
        let proposed = current.replacingCharacters(in: range, with: replacement)
        let caret = range.location + (replacement as NSString).length
        let regrouped = regroup(proposed)
        guard regrouped != proposed else { return Edit(text: proposed, caret: caret) }
        let digitsBefore = (proposed as NSString).substring(to: caret).filter(\.isASCIIDigit).count
        return Edit(text: regrouped, caret: offset(afterDigits: digitsBefore, in: regrouped))
    }

    /// The UTF-16 offset of the last digit before `location`, or nil if there is none.
    private static func lastDigit(in text: NSString, before location: Int) -> Int? {
        let prefix = text.substring(to: location)
        guard let index = prefix.lastIndex(where: \.isASCIIDigit) else { return nil }
        return NSRange(index..<prefix.endIndex, in: prefix).location
    }

    /// The UTF-16 offset just after the `count`th digit of `text`, or 0 when `count` is 0.
    private static func offset(afterDigits count: Int, in text: String) -> Int {
        guard count > 0 else { return 0 }
        var seen = 0
        for index in text.indices where text[index].isASCIIDigit {
            seen += 1
            if seen == count { return NSRange(text.startIndex...index, in: text).length }
        }
        return (text as NSString).length
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
