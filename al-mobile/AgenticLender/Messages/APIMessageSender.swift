import Foundation
import os

/// Calls al-core's message endpoints through the API gateway with the borrower's Firebase ID token:
/// `POST /core/applications/{id}/messages` to send and `POST .../messages/read` to mark replies read.
/// al-core is the only writer of messages; the app reads them from Firestore.
struct APIMessageSender: Sendable {
    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token; throws `MessageError.signedOut` when there is none.
    let idToken: @Sendable () async throws -> String

    private let logger = Logger(category: "Messages")

    init(baseURL: URL, session: URLSession, idToken: @escaping @Sendable () async throws -> String) {
        self.baseURL = baseURL
        self.session = session
        self.idToken = idToken
    }

    /// Sends the text and returns the saved message's id, so the app can tell when the thread has it.
    func send(_ text: String, on applicationID: String) async throws -> String {
        let body = try JSONEncoder().encode(["text": text])
        let (data, status) = try await post(Self.path(applicationID), body: body)
        guard status == 201 else { throw failure(status, data, "send") }
        do {
            return try JSONDecoder().decode(SavedMessage.self, from: data).id
        } catch {
            logger.error("Sending a message got an answer the app can't read: \(error.localizedDescription, privacy: .public)")
            throw MessageError.unavailable
        }
    }

    /// Marks the replies on the thread as read. al-core answers with how many it marked, which the
    /// app doesn't need: the listener brings the change.
    func markRead(on applicationID: String) async throws {
        let (data, status) = try await post(Self.path(applicationID) + "/read", body: nil)
        guard status == 200 else { throw failure(status, data, "mark read") }
    }

    private static func path(_ applicationID: String) -> String {
        "core/applications/\(applicationID)/messages"
    }

    private func post(_ path: String, body: Data?) async throws -> (Data, Int) {
        let token = try await idToken()
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let error as URLError {
            logger.error("POST /\(path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            throw MessageError.network
        }
    }

    /// A 401 means the borrower must sign in again. Anything else (an application they can't
    /// message, text al-core refused) is logged with al-core's own message and shown as not sent.
    private func failure(_ status: Int, _ data: Data, _ action: String) -> MessageError {
        if status == 401 { return .signedOut }
        let message = ErrorEnvelope.message(in: data) ?? "no message"
        logger.error("Message \(action, privacy: .public) returned \(status, privacy: .public): \(message, privacy: .public)")
        return .unavailable
    }

    private struct SavedMessage: Decodable {
        let id: String
    }
}
