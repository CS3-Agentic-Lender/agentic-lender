/// "Check your application" (Figma 13 Review): what will be sent, in four cards, each with an
/// Edit link back to its part of the form. Built only from a form that passes its checks.
struct ApplicationReview: Equatable {
    /// One card, and where its Edit link opens the form.
    enum Section: CaseIterable, Equatable {
        case you
        case money
        case loan
        case home

        var title: String {
            switch self {
            case .you: "You"
            case .money: "Your money"
            case .loan: "Your loan"
            case .home: "The home"
            }
        }

        var formAnchor: ApplicationFormAnchor {
            switch self {
            case .you: .employment
            case .money: .money
            case .loan: .loan
            case .home: .home
            }
        }
    }

    struct Row: Equatable, Hashable {
        let label: String
        let value: String
    }

    struct Card: Equatable {
        let section: Section
        let rows: [Row]
    }

    let cards: [Card]

    /// Nil when the form still has an error, so only what can be saved is ever reviewed.
    init?(form: ApplicationForm) {
        guard let draft = ApplicationDraft(form: form) else { return nil }
        cards = [
            Card(section: .you, rows: Self.you(form)),
            Card(section: .money, rows: Self.money(draft)),
            Card(section: .loan, rows: Self.loan(draft)),
            Card(section: .home, rows: Self.home(form, draft.property)),
        ]
    }

    private static func you(_ form: ApplicationForm) -> [Row] {
        let years = form.yearsInCurrentJob == 1 ? "1 year" : "\(form.yearsInCurrentJob) years"
        return [
            Row(label: "Applying", value: form.affordability.isJoint ? "Joint" : "Single"),
            Row(label: "Employment", value: "\(form.employment.title) · \(years)"),
        ]
    }

    /// Deposit and first-time buyer only belong to a mortgage, so a HELOC leaves them out.
    private static func money(_ draft: ApplicationDraft) -> [Row] {
        let mortgageOnly = draft.loanType == LoanType.mortgage.rawValue ? [
            Row(label: "Deposit", value: euro(draft.depositEur)),
            Row(label: "First-time buyer", value: draft.firstTimeBuyer ? "Yes" : "No"),
        ] : []
        return [
            Row(label: "Gross yearly income", value: euro(draft.grossIncomeEur)),
            Row(label: "Monthly debts", value: euro(draft.monthlyDebtsEur)),
        ] + mortgageOnly + [
            Row(label: "Monthly take-home pay", value: euro(draft.monthlyTakeHomeEur)),
            Row(label: "Monthly living costs", value: euro(draft.monthlyLivingCostsEur)),
        ]
    }

    private static func loan(_ draft: ApplicationDraft) -> [Row] {
        [
            Row(label: "Loan amount", value: euro(draft.loanAmountEur)),
            Row(label: "Term", value: "\(draft.termYears) years"),
        ]
    }

    /// The checked values (Eircode in capitals with its space), named as the form's pickers name them.
    private static func home(_ form: ApplicationForm, _ property: PropertyDraft) -> [Row] {
        let address = [property.addressLine1, property.addressLine2].compactMap { $0 }.joined(separator: ", ")
        return [
            Row(label: "Address", value: address),
            Row(label: "Eircode", value: property.eircode),
            Row(label: "County", value: form.property.county?.name ?? property.county),
            Row(label: "Asking price", value: euro(property.askingPriceEur)),
            Row(label: "Property type", value: form.property.propertyType?.title ?? property.propertyType),
            Row(label: "Size", value: "\(EuroAmount.format(property.floorAreaSqm)) m²"),
            Row(label: "Bedrooms", value: "\(property.bedrooms)"),
            Row(label: "BER rating", value: form.property.berRating?.title ?? property.berRating),
        ]
    }

    private static func euro(_ amount: Int) -> String {
        "€\(EuroAmount.format(amount))"
    }
}

/// Where the review's Edit links land in the application form.
enum ApplicationFormAnchor: Hashable {
    case money
    case loan
    case employment
    case home
}

/// The reference shown once an application is submitted (Figma 13b): the first eight characters of
/// al-core's application id as stored, so it reads the same as the id the broker and underwriter see.
struct ApplicationReference: Equatable {
    static let length = 8

    let text: String

    init(applicationID: String) {
        text = String(applicationID.prefix(Self.length))
    }
}
