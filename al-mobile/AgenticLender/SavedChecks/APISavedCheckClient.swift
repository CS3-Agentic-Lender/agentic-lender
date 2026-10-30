import Foundation
import os

/// Calls al-core's saved checks endpoints through the API gateway with the borrower's Firebase ID token.
/// It has its own requests, unlike `APIGateway`, because a full list (409) and an already-deleted check
/// (404) need their own answers.
struct APISavedCheckClient: Sendable {
    static let path = "core/saved-checks"

    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token; throws `APIError.signedOut` when there is none.
    let idToken: @Sendable () async throws -> String

    private var logger: Logger { Logger(category: "SavedChecks") }

    func save(_ draft: SavedCheckDraft) async throws -> String {
        let (data, status) = try await send("POST", Self.path, body: draft.body())
        switch status {
        case 201, 200:
            guard let saved = try? JSONDecoder().decode(SavedID.self, from: data) else {
                logger.error("POST /core/saved-checks sent an answer the app can't read")
                throw SavedCheckError.unavailable
            }
            return saved.id
        case 401: throw SavedCheckError.signedOut
        case 409: throw SavedCheckError.limitReached
        default:
            logger.error("POST /core/saved-checks returned \(status, privacy: .public)")
            throw SavedCheckError.unavailable
        }
    }

    func delete(id: String) async throws {
        let (_, status) = try await send("DELETE", "\(Self.path)/\(id)", body: nil)
        switch status {
        case 204, 200, 404: return
        case 401: throw SavedCheckError.signedOut
        default:
            logger.error("DELETE /core/saved-checks returned \(status, privacy: .public)")
            throw SavedCheckError.unavailable
        }
    }

    private struct SavedID: Decodable {
        let id: String
    }

    private func send(_ method: String, _ path: String, body: Data?) async throws -> (Data, Int) {
        let token: String
        do {
            token = try await idToken()
        } catch APIError.network {
            throw SavedCheckError.network
        } catch {
            throw SavedCheckError.signedOut
        }
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            logger.error("\(method, privacy: .public) /core/saved-checks failed: \(error.localizedDescription, privacy: .public)")
            throw SavedCheckError.network
        }
    }
}
