/// The loan application form (Figma "12 Application form" and 12a Above your maximum),
/// started from a completed affordability check.
struct ApplicationForm: Equatable {
    static let yearsInJobRange = 0...50

    /// The affordability answers it starts from: single or joint, household income, debts, deposit, buyer status.
    let affordability: AffordabilityRequest
    /// The maximum loan from the affordability check, for the above-maximum warning.
    let maxLoanEur: Double
    /// Chosen at the start of the affordability check (AL-206).
    let loanType: LoanType

    var loanAmount = ""
    var termYears: Int
    var employment: Employment = .employed
    var yearsInCurrentJob = 0
    var monthlyTakeHome = ""
    var monthlyLivingCosts = ""

    init(affordability: AffordabilityRequest, maxLoanEur: Double, loanType: LoanType = .mortgage) {
        self.affordability = affordability
        self.maxLoanEur = maxLoanEur
        self.loanType = loanType
        termYears = affordability.termYears
    }

    /// Employment type, with the values agreed for the applications schema (AL-209).
    enum Employment: String, CaseIterable {
        case employed
        case selfEmployed = "self_employed"
        case other

        var title: String {
            switch self {
            case .employed: "Employed"
            case .selfEmployed: "Self-employed"
            case .other: "Other"
            }
        }
    }
}

/// Every application field that can show an error.
enum ApplicationField: CaseIterable, Hashable {
    case monthlyTakeHome
    case monthlyLivingCosts
    case loanAmount
}

/// A checked application, in whole euro, with the field values of the agreed applications schema.
/// Saving it is the application endpoint's job (AL-221).
struct ApplicationDraft: Equatable {
    let loanType: String
    let applicants: String
    let grossIncomeEur: Int
    let monthlyDebtsEur: Int
    let depositEur: Int
    let firstTimeBuyer: Bool
    let termYears: Int
    let loanAmountEur: Int
    let employmentType: String
    let yearsInCurrentJob: Int
    let monthlyTakeHomeEur: Int
    let monthlyLivingCostsEur: Int

    init?(form: ApplicationForm) {
        guard ApplicationValidator.errors(for: form).isEmpty,
              let loan = EuroAmount.parse(form.loanAmount),
              let takeHome = EuroAmount.parse(form.monthlyTakeHome),
              let livingCosts = EuroAmount.parse(form.monthlyLivingCosts)
        else { return nil }

        let affordability = form.affordability
        loanType = form.loanType.rawValue
        applicants = affordability.isJoint ? "joint" : "single"
        grossIncomeEur = affordability.householdGrossIncome
        monthlyDebtsEur = affordability.monthlyDebts
        depositEur = affordability.deposit
        firstTimeBuyer = affordability.isFirstTimeBuyer
        termYears = form.termYears
        loanAmountEur = loan
        employmentType = form.employment.rawValue
        yearsInCurrentJob = form.yearsInCurrentJob
        monthlyTakeHomeEur = takeHome
        monthlyLivingCostsEur = livingCosts
    }
}
