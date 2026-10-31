import Foundation

/// The local stack the UI tests run against: the Firebase emulators started from `al-core/` and the
/// API gateway from `docker compose`. Ports match `BackendConfig` and `al-core/firebase.json`.
///
/// Test setup and clean-up go straight to the emulators' REST APIs with the `owner` token, which
/// skips the security rules. The app itself only ever goes through the rules and the gateway.
enum EmulatorBackend {
    static let projectID = "demo-al"
    static let authURL = URL(string: "http://localhost:9099")!
    static let firestoreURL = URL(string: "http://localhost:8080/v1/projects/\(projectID)/databases/(default)/documents")!
    static let gatewayURL = URL(string: "http://localhost:8000")!
    /// The Auth emulator takes any API key.
    static let apiKey = "demo-api-key"
    /// Lets a request past the Firestore and Auth emulators' rules.
    static let ownerToken = "owner"

    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    // MARK: Requests

    /// Sends a request and returns its JSON body, failing on any status outside 200...299.
    @discardableResult
    static func send(
        _ method: String,
        _ url: URL,
        token: String? = nil,
        json: Any? = nil
    ) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(decoding: data, as: UTF8.self)
            throw Failure(description: "\(method) \(url.path()) returned \(status): \(body)")
        }
        guard !data.isEmpty else { return [:] }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    /// Like `send`, for an answer that is a JSON array, such as `GET /core/brokers`.
    static func sendForList(_ url: URL, token: String) async throws -> [[String: Any]] {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            throw Failure(description: "GET \(url.path()) returned \(status): \(String(decoding: data, as: UTF8.self))")
        }
        return (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    static func gateway(_ path: String) -> URL {
        gatewayURL.appending(path: path)
    }

    /// A Firestore document or collection URL from its path under `documents/`, such as `users/abc`.
    static func firestore(_ path: String) -> URL {
        firestoreURL.appending(path: path)
    }

    // MARK: Firestore values

    /// A value in the Firestore REST format: strings, whole numbers, dates, arrays and maps.
    static func value(_ raw: Any) -> [String: Any] {
        switch raw {
        case let text as String: return ["stringValue": text]
        case let number as Int: return ["integerValue": String(number)]
        case let date as Date: return ["timestampValue": ISO8601DateFormatter().string(from: date)]
        case let list as [Any]: return ["arrayValue": ["values": list.map(value)]]
        case let map as [String: Any]: return ["mapValue": ["fields": map.mapValues(value)]]
        default: return ["nullValue": NSNull()]
        }
    }
}
