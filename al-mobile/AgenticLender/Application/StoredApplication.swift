import Foundation

/// An application as `GET /core/applications/{id}` returns it: only the parts the form shows.
/// al-core sends money and sizes as floats, and leaves out what a Draft hasn't filled in yet.
struct StoredApplication: Decodable, Equatable, Sendable {
    let id: String
    let status: String
    let loanAmountEur: Double?
    let termYears: Int?
    let employmentType: String?
    let yearsInCurrentJob: Double?
    let monthlyTakeHomeEur: Double?
    let monthlyLivingCostsEur: Double?
    let property: Property?

    struct Property: Decodable, Equatable, Sendable {
        let addressLine1: String?
        let addressLine2: String?
        let eircode: String?
        let county: String?
        let propertyType: String?
        let bedrooms: Int?
        let floorAreaSqm: Double?
        let berRating: String?
        let askingPriceEur: Double?

        private enum CodingKeys: String, CodingKey {
            case addressLine1 = "address_line_1"
            case addressLine2 = "address_line_2"
            case eircode, county, bedrooms
            case propertyType = "property_type"
            case floorAreaSqm = "floor_area_sqm"
            case berRating = "ber_rating"
            case askingPriceEur = "asking_price_eur"
        }
    }

    /// Only a Draft can be changed; once submitted it is read-only.
    var isDraft: Bool { status == "Draft" }

    /// Declined or Closed (al-core's `FINISHED`): the borrower can start a new application.
    var isFinished: Bool { ["Declined", "Closed"].contains(status) }

    /// The form with this application's saved values in its own fields. The affordability answers,
    /// maximum and loan type stay as the new check gave them, and anything not saved, or a value
    /// the app doesn't offer, stays as it was.
    func filling(_ form: ApplicationForm) -> ApplicationForm {
        var filled = form
        filled.loanAmount = Self.amountText(loanAmountEur) ?? form.loanAmount
        filled.termYears = termYears ?? form.termYears
        filled.employment = employmentType.flatMap(ApplicationForm.Employment.init(rawValue:)) ?? form.employment
        filled.yearsInCurrentJob = yearsInCurrentJob.map { Int($0.rounded()) } ?? form.yearsInCurrentJob
        filled.monthlyTakeHome = Self.amountText(monthlyTakeHomeEur) ?? form.monthlyTakeHome
        filled.monthlyLivingCosts = Self.amountText(monthlyLivingCostsEur) ?? form.monthlyLivingCosts
        filled.property = property.map { $0.filling(form.property) } ?? form.property
        return filled
    }

    /// A whole amount as the form shows it, such as "210,000".
    fileprivate static func amountText(_ value: Double?) -> String? {
        value.map { EuroAmount.format(Int($0.rounded())) }
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, property
        case loanAmountEur = "loan_amount_eur"
        case termYears = "term_years"
        case employmentType = "employment_type"
        case yearsInCurrentJob = "years_in_current_job"
        case monthlyTakeHomeEur = "monthly_take_home_eur"
        case monthlyLivingCostsEur = "monthly_living_costs_eur"
    }
}

private extension StoredApplication.Property {
    func filling(_ property: ApplicationProperty) -> ApplicationProperty {
        var filled = property
        filled.addressLine1 = addressLine1 ?? property.addressLine1
        filled.addressLine2 = addressLine2 ?? property.addressLine2
        filled.eircode = eircode ?? property.eircode
        filled.county = county.flatMap(County.init(rawValue:)) ?? property.county
        filled.askingPrice = StoredApplication.amountText(askingPriceEur) ?? property.askingPrice
        filled.propertyType = propertyType.flatMap(PropertyType.init(rawValue:)) ?? property.propertyType
        filled.bedrooms = bedrooms ?? property.bedrooms
        filled.floorArea = StoredApplication.amountText(floorAreaSqm) ?? property.floorArea
        filled.berRating = berRating.flatMap(BERRating.init(rawValue:)) ?? property.berRating
        return filled
    }
}
