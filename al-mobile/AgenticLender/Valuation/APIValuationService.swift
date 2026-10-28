import Foundation
import os

/// Calls `POST /ai/valuation` through the API gateway with the borrower's Firebase ID token.
/// Failures are `APIError`s.
struct APIValuationService: ValuationService {
    static let path = "ai/valuation"

    let baseURL: URL
    let session: URLSession
    let idToken: @Sendable () async throws -> String

    func value(_ request: ValuationRequest) async throws -> ValuationResult {
        let gateway = APIGateway(baseURL: baseURL, session: session, idToken: idToken, logger: Logger(category: "Valuation"))
        return try await gateway.post(Self.path, body: request.body(), decode: ValuationResult.decode)
    }
}
