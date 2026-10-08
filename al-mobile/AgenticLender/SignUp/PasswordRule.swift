/// The rules a sign-up password must meet, in the order the checklist shows them.
///
/// At least 8 characters with a letter and a number: stronger than Firebase's
/// 6-character minimum and simple enough to explain on screen.
enum PasswordRule: CaseIterable, Hashable {
    case minimumLength
    case containsLetter
    case containsNumber

    static let requiredLength = 8

    var label: String {
        switch self {
        case .minimumLength: "At least \(Self.requiredLength) characters"
        case .containsLetter: "Contains a letter"
        case .containsNumber: "Contains a number"
        }
    }

    func isMet(by password: String) -> Bool {
        switch self {
        case .minimumLength: password.count >= Self.requiredLength
        case .containsLetter: password.contains(where: \.isLetter)
        case .containsNumber: password.contains { $0.isASCII && $0.isWholeNumber }
        }
    }

    static func met(by password: String) -> Set<PasswordRule> {
        Set(allCases.filter { $0.isMet(by: password) })
    }

    static func allMet(by password: String) -> Bool {
        allCases.allSatisfy { $0.isMet(by: password) }
    }
}
