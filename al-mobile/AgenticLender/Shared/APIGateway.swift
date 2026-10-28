import Foundation
import os

/// Why a call through the API gateway failed. Each screen turns it into its own message.
enum APIError: Error, Equatable {
    /// No connection, or the gateway couldn't be reached.
    case network
    /// No signed-in user, or the ID token was refused.
    case signedOut
    /// Any other failure, or an answer that doesn't match the contract.
    case unavailable
}

/// Posts JSON to the API gateway with the signed-in user's Firebase ID token.
struct APIGateway {
    let baseURL: URL
    let session: URLSession
    /// The signed-in user's ID token. Whatever it throws reaches the caller unchanged.
    let idToken: @Sendable () async throws -> String
    let logger: Logger

    /// Sends the body and decodes a 2xx answer. A 401 is `.signedOut`; any other status, or an answer
    /// that doesn't decode, is `.unavailable`.
    func post<Result>(_ path: String, body: Data, decode: (Data) throws -> Result) async throws -> Result {
        let token = try await idToken()
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await send(request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.signedOut }
        guard (200..<300).contains(status) else {
            logger.error("\(path, privacy: .public) returned \(status, privacy: .public)")
            throw APIError.unavailable
        }
        do {
            return try decode(data)
        } catch {
            logger.error("\(path, privacy: .public) answer didn't match the contract: \(error.localizedDescription, privacy: .public)")
            throw APIError.unavailable
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            logger.error("Request failed: \(error.localizedDescription, privacy: .public)")
            throw APIError.network
        }
    }
}
