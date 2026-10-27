/// What the borrower wants to borrow, chosen once at the start of the affordability check
/// and carried into the application. Raw values match the applications schema.
enum LoanType: String, CaseIterable, Hashable {
    case mortgage
    case heloc

    /// The choice card's heading (Figma 07h).
    var title: String {
        switch self {
        case .mortgage: "Buy a home"
        case .heloc: "Borrow against my home"
        }
    }

    /// The choice card's explanation (Figma 07h).
    var detail: String {
        switch self {
        case .mortgage:
            "Mortgage. See how much you can borrow from your income and deposit."
        case .heloc:
            "Home equity line of credit (HELOC). See how much you can borrow against the value of the home you own."
        }
    }
}
