/// The 26 counties of the Republic of Ireland, in the order the county picker lists them.
enum County: String, CaseIterable, Identifiable, Codable {
    case carlow = "Carlow"
    case cavan = "Cavan"
    case clare = "Clare"
    case cork = "Cork"
    case donegal = "Donegal"
    case dublin = "Dublin"
    case galway = "Galway"
    case kerry = "Kerry"
    case kildare = "Kildare"
    case kilkenny = "Kilkenny"
    case laois = "Laois"
    case leitrim = "Leitrim"
    case limerick = "Limerick"
    case longford = "Longford"
    case louth = "Louth"
    case mayo = "Mayo"
    case meath = "Meath"
    case monaghan = "Monaghan"
    case offaly = "Offaly"
    case roscommon = "Roscommon"
    case sligo = "Sligo"
    case tipperary = "Tipperary"
    case waterford = "Waterford"
    case westmeath = "Westmeath"
    case wexford = "Wexford"
    case wicklow = "Wicklow"

    var id: String { rawValue }
    var name: String { rawValue }
}
