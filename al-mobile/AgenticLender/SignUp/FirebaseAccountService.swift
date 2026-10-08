import FirebaseAuth
import FirebaseFirestore
import os

/// Creates the login in Firebase Auth, then saves the profile to `users/{uid}` in Firestore.
///
/// If the profile can't be saved, the new login is deleted again so the borrower
/// can retry with the same email instead of being left with half an account.
struct FirebaseAccountService: AccountService {
    private let logger = Logger(subsystem: "ie.mtu.agenticlender", category: "SignUp")

    func createAccount(_ account: NewAccount) async throws -> String {
        let result: AuthDataResult
        do {
            result = try await Auth.auth().createUser(withEmail: account.email, password: account.password)
        } catch {
            logger.error("Creating the Firebase Auth user failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError(authError: error)
        }

        let user = result.user
        guard let profile = account.profile(uid: user.uid) else {
            logger.error("Validated sign-up form did not produce a profile")
            await deleteUnfinished(user)
            throw AccountError.unknown
        }

        do {
            var data = try Firestore.Encoder().encode(profile)
            data["createdAt"] = FieldValue.serverTimestamp()
            try await Firestore.firestore()
                .collection(BorrowerProfile.collection)
                .document(user.uid)
                .setData(data)
        } catch {
            logger.error("Saving the borrower profile failed: \(error.localizedDescription, privacy: .public)")
            await deleteUnfinished(user)
            throw AccountError.profileNotSaved
        }

        return user.uid
    }

    private func deleteUnfinished(_ user: User) async {
        do {
            try await user.delete()
        } catch {
            logger.error("Removing the unfinished Auth user failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

extension AccountError {
    init(authError: Error) {
        let nsError = authError as NSError
        guard nsError.domain == AuthErrorDomain else {
            self = .unknown
            return
        }
        switch AuthErrorCode(rawValue: nsError.code) {
        case .emailAlreadyInUse: self = .emailAlreadyInUse
        case .invalidEmail: self = .invalidEmail
        case .weakPassword: self = .weakPassword
        case .networkError: self = .network
        default: self = .unknown
        }
    }
}
