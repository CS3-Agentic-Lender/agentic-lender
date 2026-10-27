import Foundation

/// A checked HELOC check, ready to send to `POST /ai/affordability` with `loan_type: heloc`.
///
/// Fields follow Nic's answer on the HELOC endpoint ticket (AL-198). There is no home value and no
/// deposit: the endpoint values the home with the model, from the five house details.
struct HELOCRequest: Hashable {
    let county: County
    let propertyType: PropertyType
    let floorAreaM2: Int
    let bedrooms: Int
    let berRating: BERRating
    let mortgageBalance: Int
    let grossIncome: Int
    let monthlyDebts: Int
    let termYears: Int

    /// Nil while the form still has an error, so nothing invalid is ever sent.
    init?(form: HELOCCheckForm) {
        guard HELOCCheckValidator.errors(for: form).isEmpty,
              let county = form.county,
              let propertyType = form.propertyType,
              let berRating = form.berRating,
              let floorArea = EuroAmount.parse(form.floorArea),
              let balance = EuroAmount.parse(form.mortgageBalance),
              let income = EuroAmount.parse(form.income),
              let debts = EuroAmount.parse(form.monthlyDebts)
        else { return nil }

        self.county = county
        self.propertyType = propertyType
        floorAreaM2 = floorArea
        bedrooms = form.bedrooms
        self.berRating = berRating
        mortgageBalance = balance
        grossIncome = income
        monthlyDebts = debts
        termYears = form.termYears
    }

    /// The JSON body for `POST /ai/affordability`.
    func body() throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return try encoder.encode(Body(
            loanType: LoanType.heloc.rawValue,
            county: county.rawValue,
            propertyType: propertyType.rawValue,
            bedrooms: bedrooms,
            floorAreaM2: floorAreaM2,
            berRating: berRating.rawValue,
            existingMortgageBalanceEur: mortgageBalance,
            grossIncomeEur: grossIncome,
            monthlyDebtsEur: monthlyDebts,
            termYears: termYears
        ))
    }

    private struct Body: Encodable {
        let loanType: String
        let county: String
        let propertyType: String
        let bedrooms: Int
        let floorAreaM2: Int
        let berRating: String
        let existingMortgageBalanceEur: Int
        let grossIncomeEur: Int
        let monthlyDebtsEur: Int
        let termYears: Int
    }
}
