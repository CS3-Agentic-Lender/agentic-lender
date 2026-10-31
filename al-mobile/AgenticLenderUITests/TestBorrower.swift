import Foundation

/// A borrower made for one test and deleted after it, so tests run in any order and leave the
/// seed data as they found it (AL-280 criterion 3).
///
/// `create()` signs up in the Auth emulator, saves the profile through `POST /core/me` and picks the
/// first seed broker, so the app opens on Home. `delete()` removes the account, `users/{uid}` and
/// every application the borrower has, with everything under them.
struct TestBorrower {
    static let password = "ui-test-pass-123" // betterleaks:allow — fake password, local Auth emulator only, never real auth

    let email: String
    let uid: String
    let idToken: String
    let fullName: String

    static func create() async throws -> TestBorrower {
        let email = "ui-test-\(UUID().uuidString.prefix(8).lowercased())@example.ie"
        let fullName = "Una Tester"
        let account = try await EmulatorBackend.send(
            "POST",
            URL(string: "\(EmulatorBackend.authURL)/identitytoolkit.googleapis.com/v1/accounts:signUp?key=\(EmulatorBackend.apiKey)")!,
            json: ["email": email, "password": password, "returnSecureToken": true]
        )
        guard let uid = account["localId"] as? String, let idToken = account["idToken"] as? String else {
            throw EmulatorBackend.Failure(description: "The Auth emulator's sign-up answer had no localId or idToken")
        }
        let signedUp = TestBorrower(email: email, uid: uid, idToken: idToken, fullName: fullName)
        do {
            try await signedUp.saveProfile()
            // Saving the profile adds the borrower role claim, which only a new ID token carries.
            let borrower = TestBorrower(email: email, uid: uid, idToken: try await signIn(email: email), fullName: fullName)
            try await borrower.chooseFirstBroker()
            return borrower
        } catch {
            // Don't leave a half-made borrower behind when setup fails.
            try? await signedUp.delete()
            throw error
        }
    }

    private static func signIn(email: String) async throws -> String {
        let answer = try await EmulatorBackend.send(
            "POST",
            URL(string: "\(EmulatorBackend.authURL)/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=\(EmulatorBackend.apiKey)")!,
            json: ["email": email, "password": password, "returnSecureToken": true]
        )
        guard let idToken = answer["idToken"] as? String else {
            throw EmulatorBackend.Failure(description: "The Auth emulator's sign-in answer had no idToken")
        }
        return idToken
    }

    private func saveProfile() async throws {
        try await EmulatorBackend.send("POST", EmulatorBackend.gateway("core/me"), token: idToken, json: [
            "full_name": fullName,
            "email": email,
            "phone": "+353871234567",
            "address_line_1": "1 Test Street",
            "county": "Cork",
            "eircode": "T12 X5R2",
        ])
    }

    private func chooseFirstBroker() async throws {
        let brokers = try await EmulatorBackend.sendForList(EmulatorBackend.gateway("core/brokers"), token: idToken)
        guard let brokerID = brokers.first?["uid"] as? String else {
            throw EmulatorBackend.Failure(description: "No brokers in the emulator: start it with --import=./seed-data")
        }
        try await EmulatorBackend.send("PUT", EmulatorBackend.gateway("core/me/broker"), token: idToken, json: ["broker_id": brokerID])
    }

    // MARK: Applications

    /// Writes a submitted mortgage application for this borrower straight to Firestore, as al-core
    /// would after a submit, and returns its id.
    func seedSubmittedApplication() async throws -> String {
        let id = Self.newDocumentID()
        let submittedAt = Date().addingTimeInterval(-3600)
        try await EmulatorBackend.send(
            "PATCH",
            EmulatorBackend.firestore("applications/\(id)"),
            token: EmulatorBackend.ownerToken,
            json: ["fields": [
                "borrowerId": EmulatorBackend.value(uid),
                "loanType": EmulatorBackend.value("mortgage"),
                "loanAmountEur": EmulatorBackend.value(250_000),
                "termYears": EmulatorBackend.value(30),
                "status": EmulatorBackend.value("Applied"),
                "createdAt": EmulatorBackend.value(submittedAt.addingTimeInterval(-600)),
                "submittedAt": EmulatorBackend.value(submittedAt),
                "statusHistory": EmulatorBackend.value([["to": "Applied", "at": submittedAt]]),
            ]]
        )
        return id
    }

    /// Moves an application to `status` the way the backend does: the status and a new history entry.
    func moveApplication(_ id: String, to status: String, history: [[String: Any]]) async throws {
        var url = URLComponents(url: EmulatorBackend.firestore("applications/\(id)"), resolvingAgainstBaseURL: false)!
        url.queryItems = [
            URLQueryItem(name: "updateMask.fieldPaths", value: "status"),
            URLQueryItem(name: "updateMask.fieldPaths", value: "statusHistory"),
        ]
        try await EmulatorBackend.send("PATCH", url.url!, token: EmulatorBackend.ownerToken, json: ["fields": [
            "status": EmulatorBackend.value(status),
            "statusHistory": EmulatorBackend.value(history),
        ]])
    }

    // MARK: Clean-up

    func delete() async throws {
        for application in try await applicationPaths() {
            try await Self.deleteRecursively(application)
        }
        try await Self.deleteRecursively("users/\(uid)")
        try await EmulatorBackend.send(
            "POST",
            URL(string: "\(EmulatorBackend.authURL)/identitytoolkit.googleapis.com/v1/projects/\(EmulatorBackend.projectID)/accounts:delete")!,
            token: EmulatorBackend.ownerToken,
            json: ["localId": uid]
        )
    }

    /// `applications/{id}` for every application whose `borrowerId` is this borrower.
    private func applicationPaths() async throws -> [String] {
        let url = URL(string: "\(EmulatorBackend.firestoreURL):runQuery")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(EmulatorBackend.ownerToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["structuredQuery": [
            "from": [["collectionId": "applications"]],
            "where": ["fieldFilter": [
                "field": ["fieldPath": "borrowerId"],
                "op": "EQUAL",
                "value": EmulatorBackend.value(uid),
            ]],
        ]])
        let (data, _) = try await URLSession.shared.data(for: request)
        let rows = (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
        return rows.compactMap { ($0["document"] as? [String: Any])?["name"] as? String }.map(Self.relativePath)
    }

    /// Deletes a document and everything under it; Firestore leaves subcollections behind otherwise.
    private static func deleteRecursively(_ path: String) async throws {
        let ids = try await EmulatorBackend.send(
            "POST",
            URL(string: "\(EmulatorBackend.firestore(path)):listCollectionIds")!,
            token: EmulatorBackend.ownerToken,
            json: [:]
        )["collectionIds"] as? [String] ?? []
        for collection in ids {
            // showMissing: a document with only subcollections under it is listed too.
            let url = URL(string: "\(EmulatorBackend.firestore("\(path)/\(collection)"))?pageSize=300&showMissing=true")!
            let listing = try await EmulatorBackend.send("GET", url, token: EmulatorBackend.ownerToken)
            let children = (listing["documents"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
            for child in children {
                try await deleteRecursively(relativePath(child))
            }
        }
        try await EmulatorBackend.send("DELETE", EmulatorBackend.firestore(path), token: EmulatorBackend.ownerToken)
    }

    /// "projects/demo-al/databases/(default)/documents/users/abc" → "users/abc".
    private static func relativePath(_ name: String) -> String {
        name.components(separatedBy: "/documents/").last ?? name
    }

    /// A 20-character id like the ones Firestore makes.
    private static func newDocumentID() -> String {
        let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<20).map { _ in letters.randomElement()! })
    }
}
