import FirebaseAuth
import Foundation
import os

/// Creates the login in Firebase Auth, then saves the profile through `POST /core/me`,
/// which also gives the account its `borrower` role.
///
/// A dropped connection or server error on the save is tried once more (`ProfileSaveStep`). If the
/// profile still can't be saved, the new login is deleted again so the borrower can retry with the
/// same email instead of being left with half an account.
struct FirebaseAccountService: AccountService {
    let profileAPI: CoreProfileAPI

    private let logger = Logger(category: "SignUp")

    init(profileAPI: CoreProfileAPI = CoreProfileAPI(
        baseURL: BackendConfig().apiBaseURL,
        send: { try await URLSession.shared.data(for: $0) }
    )) {
        self.profileAPI = profileAPI
    }

    func createAccount(_ account: NewAccount) async throws -> String {
        let result: AuthDataResult
        do {
            result = try await Auth.auth().createUser(withEmail: account.email, password: account.password)
        } catch {
            logger.error("Creating the Firebase Auth user failed: \(error.localizedDescription, privacy: .public)")
            throw AccountError(authError: error)
        }

        let user = result.user
        guard let profile = account.profile else {
            logger.error("Validated sign-up form did not produce a profile")
            await deleteUnfinished(user)
            throw AccountError.unknown
        }

        // Nothing has reached al-core without a token, so the login is removed straight away.
        let idToken: String
        do {
            idToken = try await user.getIDToken()
        } catch {
            logger.error("Getting the ID token after sign-up failed: \(error.localizedDescription, privacy: .public)")
            await deleteUnfinished(user)
            throw AccountError.profileNotSaved
        }

        let api = profileAPI
        let logger = logger
        try await ProfileSaveStep(
            save: {
                do {
                    try await api.createProfile(profile, idToken: idToken)
                } catch {
                    logger.error("Saving the borrower profile failed: \(error.localizedDescription, privacy: .public)")
                    throw error
                }
            },
            removeLogin: { await deleteUnfinished(user) }
        ).run()

        await refreshRole(of: user)
        return user.uid
    }

    /// The token from before `POST /core/me` has no role yet, so later API calls need a fresh one
    /// (api-design.md, section 4). The account is already complete, so a failure here is only logged:
    /// Firebase refreshes the token again within the hour.
    private func refreshRole(of user: User) async {
        do {
            _ = try await user.getIDTokenResult(forcingRefresh: true)
        } catch {
            logger.error("Refreshing the ID token after sign-up failed: \(error.localizedDescription, privacy: .public)")
        }
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
