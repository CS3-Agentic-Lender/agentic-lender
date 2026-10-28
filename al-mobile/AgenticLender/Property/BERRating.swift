/// A home's Building Energy Rating, or Unknown. Raw values are what the valuation model accepts.
///
/// The SEAI scale changed on 24 May 2026 to A0 and A to G with no subgrades. Certificates on the older
/// A1 to G scale stay valid, so both scales are here. F and G are on both.
enum BERRating: String, CaseIterable, Identifiable, Hashable {
    case a0 = "A0"
    case a = "A", b = "B", c = "C", d = "D", e = "E"
    case a1 = "A1", a2 = "A2", a3 = "A3"
    case b1 = "B1", b2 = "B2", b3 = "B3"
    case c1 = "C1", c2 = "C2", c3 = "C3"
    case d1 = "D1", d2 = "D2"
    case e1 = "E1", e2 = "E2"
    case f = "F"
    case g = "G"
    case unknown = "Unknown"

    /// A titled run of grades in a picker.
    struct Group: Hashable {
        let title: String?
        let ratings: [BERRating]
    }

    static let newScale: [BERRating] = [.a0, .a, .b, .c, .d, .e, .f, .g]
    static let olderScale: [BERRating] = [.a1, .a2, .a3, .b1, .b2, .b3, .c1, .c2, .c3, .d1, .d2, .e1, .e2, .f, .g]

    /// The affordability and HELOC forms: the older scale, as before. Their endpoint doesn't take A0.
    static let affordabilityGroups = [Group(title: nil, ratings: olderScale + [.unknown])]

    /// The property check (Figma 10b): Don't know, then the new scale, then the older one.
    static let valuationGroups = [
        Group(title: nil, ratings: [.unknown]),
        Group(title: "Certificate from 24 May 2026", ratings: newScale),
        Group(title: "Older certificate", ratings: olderScale),
    ]

    var id: String { rawValue }

    /// How the picker shows it.
    var title: String {
        self == .unknown ? "I don't know" : rawValue
    }
}
