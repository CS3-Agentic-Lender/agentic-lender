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
struct AffordabilityRequest: Hashable {
    let isJoint: Bool
    let grossIncome: Int
    let secondGrossIncome: Int?
    let monthlyDebts: Int
    let deposit: Int
    let termYears: Int
    let isFirstTimeBuyer: Bool

    /// The HELOC check's money answers, in the shape the application form starts from (AL-208). A HELOC
    /// has no deposit and no first-time buyer, and its income is one household total.
    init(helocCheck request: HELOCRequest) {
        isJoint = false
        grossIncome = request.grossIncome
        secondGrossIncome = nil
        monthlyDebts = request.monthlyDebts
        deposit = 0
        termYears = request.termYears
        isFirstTimeBuyer = false
    }

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
