/// What the borrower has typed into the affordability check (Figma frames "Affordability form", 07a and 07b).
struct AffordabilityForm: Equatable {
    static let defaultTermYears = 30

    var applicants: Applicants = .single
    var income = ""
    var secondIncome = ""
    var monthlyDebts = ""
    var deposit = ""
    var termYears = defaultTermYears
    var isFirstTimeBuyer = true

    enum Applicants: Equatable, CaseIterable {
        case single
        case joint
    }
}

/// Every field that can show an error.
enum AffordabilityField: CaseIterable, Hashable {
    case income
    case secondIncome
    case monthlyDebts
    case deposit
    case term
}

/// A checked affordability form in whole euro, ready to send to the affordability endpoint.
struct AffordabilityRequest: Equatable {
    let isJoint: Bool
    let grossIncome: Int
    let secondGrossIncome: Int?
    let monthlyDebts: Int
    let deposit: Int
    let termYears: Int
    let isFirstTimeBuyer: Bool

    init?(form: AffordabilityForm) {
        guard AffordabilityValidator.errors(for: form).isEmpty,
              let income = EuroAmount.parse(form.income),
              let debts = EuroAmount.parse(form.monthlyDebts),
              let deposit = EuroAmount.parse(form.deposit)
        else { return nil }

        isJoint = form.applicants == .joint
        grossIncome = income
        secondGrossIncome = isJoint ? EuroAmount.parse(form.secondIncome) : nil
        monthlyDebts = debts
        self.deposit = deposit
        termYears = form.termYears
        isFirstTimeBuyer = form.isFirstTimeBuyer
    }
}
