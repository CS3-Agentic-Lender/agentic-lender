/// The property check result's text for one check (AL-144, Figma 11 to 11c).
///
/// The estimate is the model's estimate of a 2024 asking price, never called a valuation. Fair or
/// Over-priced comes from the endpoint's "price needs review" flag; the app doesn't decide it.
struct ValuationSummary: Hashable {
    enum Verdict: Hashable {
        case fair
        case overPriced

        var label: String {
            switch self {
            case .fair: "Fair"
            case .overPriced: "Over-priced"
            }
        }
    }

    static let basisText = "Estimate based on 2024 asking prices, to the nearest €1,000. Not a valuation."

    let title: String
    /// e.g. "Semi-detached · 3 bed · 110 m² · BER B3".
    let details: String
    let estimate: String
    let basis = basisText
    /// Nil when no asking price was given (Figma 11c).
    let verdict: Verdict?
    let askingPrice: String?
    let comparison: String?
    /// Why the estimate is less reliable, as the endpoint words it (Figma 11b).
    let warnings: [String]

    init(request: ValuationRequest, result: ValuationResult) {
        title = Self.title(county: request.county, propertyType: request.propertyType)
        let ber = request.berRating == .unknown ? "BER not known" : "BER \(request.berRating.rawValue)"
        details = [
            request.propertyType.title,
            "\(request.bedrooms) bed",
            "\(EuroAmount.format(request.floorAreaM2)) m²",
            ber,
        ].joined(separator: " · ")
        estimate = Self.euro(result.displayEstimateEur)
        warnings = result.supportWarnings

        guard let asking = request.askingPriceEur, let flagged = result.priceNeedsReview, let gap = result.askingPriceGap else {
            verdict = nil
            askingPrice = nil
            comparison = nil
            return
        }
        verdict = flagged ? .overPriced : .fair
        askingPrice = Self.euro(asking)
        comparison = Self.comparison(asking: asking, estimate: result.displayEstimateEur, gap: gap, flagged: flagged)
    }

    /// "Cork semi-detached": the result screen's heading and a saved check's name.
    static func title(county: County, propertyType: PropertyType) -> String {
        "\(county.name) \(propertyType.title.lowercased())"
    }

    /// How far the asking price is from the shown estimate, in euro and as the endpoint's gap.
    private static func comparison(asking: Int, estimate: Int, gap: Double, flagged: Bool) -> String {
        let ending = flagged ? "so the model flags it for review." : "which the model doesn't flag."
        let difference = asking - estimate
        guard difference != 0 else { return "The asking price is the same as the estimate, \(ending)" }
        let direction = difference > 0 ? "above" : "below"
        let percent = Int((abs(gap) * 100).rounded())
        return "The asking price is \(euro(abs(difference))) (\(percent)%) \(direction) the estimate, \(ending)"
    }

    private static func euro(_ amount: Int) -> String {
        "€\(EuroAmount.format(amount))"
    }
}
