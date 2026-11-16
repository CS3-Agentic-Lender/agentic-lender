/// What the Profile screen shows (AL-312, Figma 19): who is signed in and the rows on offer.
///
/// "Your details" is added once there's a screen to edit them, so no row leads nowhere.
struct ProfileSummary: Equatable {
    enum Row: Equatable {
        /// Opens the change-broker screen. The name is nil if it isn't known.
        case broker(name: String?)
        /// Opens the support form (AL-149).
        case helpAndSupport
        /// Opens Rate the app (AL-150).
        case rateTheApp
    }

    let name: String
    let email: String?
    let initials: String
    let rows: [Row]

    init(profile: CoreProfile, email: String?) {
        name = profile.fullName
        self.email = email
        initials = PersonName.initials(of: profile.fullName)
        rows = [.broker(name: profile.brokerName), .helpAndSupport, .rateTheApp]
    }
}
