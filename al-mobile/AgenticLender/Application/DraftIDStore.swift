import Foundation

/// Keeps the id of the borrower's Draft on the phone, so the form can reopen it.
/// al-core has no "my applications" list, so this is how the app finds the Draft again.
protocol DraftIDStore: Sendable {
    func draftID() -> String?
    func remember(_ id: String)
    func forget()
}

/// One Draft id per signed-in borrower, so someone else signing in on the same phone starts afresh.
struct UserDefaultsDraftIDStore: DraftIDStore, @unchecked Sendable {
    let userID: String
    var defaults: UserDefaults = .standard

    private var key: String { "draftApplicationID.\(userID)" }

    func draftID() -> String? { defaults.string(forKey: key) }
    func remember(_ id: String) { defaults.set(id, forKey: key) }
    func forget() { defaults.removeObject(forKey: key) }
}

/// Used when nobody is signed in: there is no Draft to reopen, and saving fails as signed out anyway.
struct NoDraftIDStore: DraftIDStore {
    func draftID() -> String? { nil }
    func remember(_ id: String) {}
    func forget() {}
}
