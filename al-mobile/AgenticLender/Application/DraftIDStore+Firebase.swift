import FirebaseAuth

/// The store the app uses: the draft id of whoever is signed in right now.
func liveDraftIDStore() -> DraftIDStore {
    guard let uid = Auth.auth().currentUser?.uid else { return NoDraftIDStore() }
    return UserDefaultsDraftIDStore(userID: uid)
}
