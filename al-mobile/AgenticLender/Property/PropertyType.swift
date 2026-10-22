/// The kind of home: the eight types the valuation model is trained on.
/// Raw values are the model's own spelling (Nic's data readiness report for the Daft.ie 2024 listings),
/// kept here in one place until the app reads them from `GET /ai/valuation/options`.
enum PropertyType: String, CaseIterable, Identifiable, Hashable {
    case detached = "Detached"
    case semiDetached = "Semi-D"
    case terrace = "Terrace"
    case endOfTerrace = "End of Terrace"
    case bungalow = "Bungalow"
    case apartment = "Apartment"
    case duplex = "Duplex"
    case townhouse = "Townhouse"

    var id: String { rawValue }

    /// How the picker shows it.
    var title: String {
        switch self {
        case .semiDetached: "Semi-detached"
        case .terrace: "Terraced"
        case .endOfTerrace: "End of terrace"
        default: rawValue
        }
    }
}
