import Foundation
import os

/// Calls `POST /ai/affordability` through the API gateway with the borrower's Firebase ID token,
/// for a mortgage or, with `loan_type: heloc`, a HELOC.
struct APIAffordabilityService: AffordabilityService, HELOCService {
    static let path = "ai/affordability"
    /// A request that hangs shows "Check your connection" after this, not URLSession's 60 seconds
    /// (AL-261). A timeout is a `URLError`, so it reads as a dropped connection, with Retry.
    static let timeout: TimeInterval = 15

    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token; throws `AffordabilityError.signedOut` when there is none.
    let idToken: @Sendable () async throws -> String

    func calculate(_ request: AffordabilityRequest) async throws -> AffordabilityResult {
        try await post(request.body(), decode: AffordabilityResult.decode)
    }

    func checkHELOC(_ request: HELOCRequest) async throws -> HELOCResult {
        try await post(request.body(), decode: HELOCResult.decode)
    }

    private func post<Result>(_ body: Data, decode: (Data) throws -> Result) async throws -> Result {
        let gateway = APIGateway(
            baseURL: baseURL, session: session, idToken: idToken, logger: Logger(category: "Affordability"), timeout: Self.timeout
        )
        do {
            return try await gateway.post(Self.path, body: body, decode: decode)
        } catch let error as APIError {
            throw AffordabilityError(error)
        }
    }
}

extension AffordabilityError {
    init(_ error: APIError) {
        switch error {
        case .network: self = .network
        case .signedOut: self = .signedOut
        case .unavailable: self = .unavailable
        }
    }
}
