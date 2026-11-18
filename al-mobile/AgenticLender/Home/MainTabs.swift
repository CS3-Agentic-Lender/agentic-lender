/// Which tab is open (AL-313, the tab bar in Figma): Home, Property, Messages and Profile.
struct MainTabs: Equatable {
    enum Tab: CaseIterable, Hashable {
        case home
        case property
        case messages
        case profile
    }

    var selected: Tab = .home

    /// Home's "Check a property" opens the Property tab, so a borrower's properties live in one place.
    mutating func checkProperty() {
        selected = .property
    }

    /// After an application is submitted the app shows Home from its first screen.
    mutating func returnedHome() {
        selected = .home
    }

    /// The Messages tab's badge: unread replies, where 0 hides it (Figma 15e).
    static func messagesBadge(unread: Int) -> Int {
        max(unread, 0)
    }
}
