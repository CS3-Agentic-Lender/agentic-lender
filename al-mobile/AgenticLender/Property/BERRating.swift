/// A home's Building Energy Rating: the SEAI grades A1 to G, or Unknown.
/// Raw values are what the valuation model accepts (Nic, on the valuation endpoint ticket).
enum BERRating: String, CaseIterable, Identifiable, Hashable {
    case a1 = "A1", a2 = "A2", a3 = "A3"
    case b1 = "B1", b2 = "B2", b3 = "B3"
    case c1 = "C1", c2 = "C2", c3 = "C3"
    case d1 = "D1", d2 = "D2"
    case e1 = "E1", e2 = "E2"
    case f = "F"
    case g = "G"
    case unknown = "Unknown"

    var id: String { rawValue }

    /// How the picker shows it.
    var title: String {
        self == .unknown ? "I don't know" : rawValue
    }
}
