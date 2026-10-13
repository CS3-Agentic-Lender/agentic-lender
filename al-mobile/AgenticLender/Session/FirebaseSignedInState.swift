import FirebaseAuth

/// Firebase Auth's saved login, kept in the keychain between launches.
struct FirebaseSignedInState: SignedInState {
    var hasSignedInUser: Bool { Auth.auth().currentUser != nil }

    func signOut() throws {
        try Auth.auth().signOut()
    }
}
