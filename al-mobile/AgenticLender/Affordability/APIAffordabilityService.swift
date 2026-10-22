import Foundation
import os

/// Calls `POST /ai/affordability` through the API gateway with the borrower's Firebase ID token.
struct APIAffordabilityService: AffordabilityService {
    static let path = "ai/affordability"

    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token; throws `AffordabilityError.signedOut` when there is none.
    let idToken: @Sendable () async throws -> String

    private let logger = Logger(category: "Affordability")

    func calculate(_ request: AffordabilityRequest) async throws -> AffordabilityResult {
        let token = try await idToken()
        var urlRequest = URLRequest(url: baseURL.appending(path: Self.path))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try request.body()

        let (data, response) = try await send(urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AffordabilityError.signedOut }
        guard (200..<300).contains(status) else {
            logger.error("Affordability endpoint returned \(status, privacy: .public)")
            throw AffordabilityError.unavailable
        }
        do {
            return try AffordabilityResult.decode(data)
        } catch {
            logger.error("Affordability response didn't match the contract: \(error.localizedDescription, privacy: .public)")
            throw AffordabilityError.unavailable
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            logger.error("Affordability request failed: \(error.localizedDescription, privacy: .public)")
            throw AffordabilityError.network
        }
    }
}
