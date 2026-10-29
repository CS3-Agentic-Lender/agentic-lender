import Foundation

/// The "Compared with a typical listing" section of the property result (AL-136, Figma 11e).
///
/// It starts at the model's typical listing, lists how far each detail moved this home's estimate
/// (largest first) and ends at the estimate. Every figure is to the nearest €1,000, like the
/// headline. Rounding each row on its own can miss the headline by a thousand or two, so the rows
/// nearest to rounding the other way are moved by €1,000 until the section adds up exactly.
struct ValuationBreakdown: Hashable {
    enum Change: Hashable {
        case up
        case down
        case none
    }

    struct Row: Hashable {
        let label: String
        /// Thousands of euro, as shown.
        let thousands: Int

        var change: Change {
            thousands > 0 ? .up : thousands < 0 ? .down : .none
        }

        /// "+€22,000", "−€5,000" (a true minus sign, as in the Figma) or "€0".
        var amount: String {
            let size = ValuationBreakdown.euro(abs(thousands))
            switch change {
            case .up: return "+\(size)"
            case .down: return "\u{2212}\(size)"
            case .none: return size
            }
        }

        /// What VoiceOver reads, so the direction never depends on the colour or the minus sign.
        var spoken: String {
            let size = ValuationBreakdown.euro(abs(thousands))
            switch change {
            case .up: return "\(label), adds \(size)"
            case .down: return "\(label), takes off \(size)"
            case .none: return "\(label), no change"
            }
        }
    }

    static let title = "Compared with a typical listing"
    static let explanation = "How far each detail moved this estimate from the average listing. It doesn't say what changing the house would do."

    /// al-ai rounds the baseline and each piece to the cent, so their sum can be a few cents off the estimate.
    private static let addUpToleranceEur = 1.0

    let typicalListingThousands: Int
    let rows: [Row]
    let estimate: String

    var typicalListing: String {
        Self.euro(typicalListingThousands)
    }

    /// Nil when the answer has no breakdown, or one that doesn't add up to the estimate: the rest of
    /// the result still shows, without this section.
    init?(request: ValuationRequest, result: ValuationResult) {
        guard let baseline = result.baselineEur,
              let pieces = result.contributions, !pieces.isEmpty,
              abs(baseline + pieces.map(\.eur).reduce(0, +) - result.estimateEur) <= Self.addUpToleranceEur
        else { return nil }

        let largestFirst = pieces.sorted { abs($0.eur) > abs($1.eur) }
        let typical = Int((baseline / 1000).rounded())
        let rowsTotal = result.displayEstimateEur / 1000 - typical
        let shown = Self.thousands(largestFirst.map(\.eur), addingUpTo: rowsTotal)
        guard shown.reduce(0, +) == rowsTotal else { return nil }

        typicalListingThousands = typical
        rows = zip(largestFirst, shown).map { piece, thousands in
            Row(label: Self.label(for: piece.feature, of: request), thousands: thousands)
        }
        estimate = "€\(EuroAmount.format(result.displayEstimateEur))"
    }

    /// Each amount to the nearest thousand, then moved by one where needed so they add up to `total`:
    /// up for the rows that were rounded down the most, or down for those rounded up the most.
    static func thousands(_ amounts: [Double], addingUpTo total: Int) -> [Int] {
        let exact = amounts.map { $0 / 1000 }
        let rounded = exact.map { Int($0.rounded()) }
        let shortfall = total - rounded.reduce(0, +)
        guard shortfall != 0 else { return rounded }

        let step = shortfall > 0 ? 1 : -1
        // Positive when a row was rounded down, negative when it was rounded up.
        let roundedDownBy = exact.indices.map { exact[$0] - Double(rounded[$0]) }
        let nearestToTurning = exact.indices.sorted {
            step > 0 ? roundedDownBy[$0] > roundedDownBy[$1] : roundedDownBy[$0] < roundedDownBy[$1]
        }
        let moved = Set(nearestToTurning.prefix(abs(shortfall)))
        return rounded.indices.map { moved.contains($0) ? rounded[$0] + step : rounded[$0] }
    }

    /// Named from what the borrower entered, so the rows read the same as the details line above.
    private static func label(for feature: String, of home: ValuationRequest) -> String {
        switch feature {
        case "county": "County: \(home.county.name)"
        case "property_type": "Type: \(home.propertyType.title)"
        case "bedrooms": "Bedrooms: \(home.bedrooms)"
        case "floor_area": "Floor area: \(EuroAmount.format(home.floorAreaM2)) m²"
        case "ber": home.berRating == .unknown ? "BER: not known" : "BER: \(home.berRating.rawValue)"
        case "eircode_area": "Eircode area: \(home.eircode.prefix(3))"
        default: feature
        }
    }

    private static func euro(_ thousands: Int) -> String {
        "€\(EuroAmount.format(thousands * 1000))"
    }
}
