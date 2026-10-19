import Foundation

/// The loan application form (Figma "12 Application form" and 12a Above your maximum),
/// started from a completed affordability check.
struct ApplicationForm: Equatable {
    static let yearsInJobRange = 0...50

    /// The affordability answers it starts from: single or joint, household income, debts, deposit, buyer status.
    let affordability: AffordabilityRequest
    /// The maximum loan from the affordability check, for the above-maximum warning.
    let maxLoanEur: Double

    var loanAmount = ""
    var termYears: Int
    var employment: Employment = .employed
    var yearsInCurrentJob = 0
    var monthlyTakeHome = ""
    var monthlyLivingCosts = ""
    var property = ApplicationProperty()

    init(affordability: AffordabilityRequest, maxLoanEur: Double) {
        self.affordability = affordability
        self.maxLoanEur = maxLoanEur
        termYears = affordability.termYears
    }

    /// Employment type, with the values agreed for the applications schema.
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
    case addressLine1
    case eircode
    case county
    case askingPrice
    case propertyType
    case floorArea
    case berRating
}

/// A checked application, in whole euro, with the field values of the agreed applications schema.
/// It is saved as a mortgage Draft through `POST /core/applications`.
struct ApplicationDraft: Encodable, Equatable {
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
    let property: PropertyDraft

    init?(form: ApplicationForm) {
        guard ApplicationValidator.errors(for: form).isEmpty,
              let loan = EuroAmount.parse(form.loanAmount),
              let takeHome = EuroAmount.parse(form.monthlyTakeHome),
              let livingCosts = EuroAmount.parse(form.monthlyLivingCosts),
              let property = PropertyDraft(property: form.property)
        else { return nil }

        let affordability = form.affordability
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
        self.property = property
    }

    /// The JSON body for `POST /core/applications`. The property type joins the property
    /// once Nic sends the values the valuation model accepts.
    func body() throws -> Data {
        try JSONEncoder().encode(self)
    }

    private enum CodingKeys: String, CodingKey {
        case loanType = "loan_type"
        case applicants
        case grossIncomeEur = "gross_income_eur"
        case monthlyDebtsEur = "monthly_debts_eur"
        case depositEur = "deposit_eur"
        case firstTimeBuyer = "first_time_buyer"
        case termYears = "term_years"
        case loanAmountEur = "loan_amount_eur"
        case employmentType = "employment_type"
        case yearsInCurrentJob = "years_in_current_job"
        case monthlyTakeHomeEur = "monthly_take_home_eur"
        case monthlyLivingCostsEur = "monthly_living_costs_eur"
        case property
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("mortgage", forKey: .loanType)
        try container.encode(applicants, forKey: .applicants)
        try container.encode(grossIncomeEur, forKey: .grossIncomeEur)
        try container.encode(monthlyDebtsEur, forKey: .monthlyDebtsEur)
        try container.encode(depositEur, forKey: .depositEur)
        try container.encode(firstTimeBuyer, forKey: .firstTimeBuyer)
        try container.encode(termYears, forKey: .termYears)
        try container.encode(loanAmountEur, forKey: .loanAmountEur)
        try container.encode(employmentType, forKey: .employmentType)
        try container.encode(yearsInCurrentJob, forKey: .yearsInCurrentJob)
        try container.encode(monthlyTakeHomeEur, forKey: .monthlyTakeHomeEur)
        try container.encode(monthlyLivingCostsEur, forKey: .monthlyLivingCostsEur)
        try container.encode(property, forKey: .property)
    }
}
