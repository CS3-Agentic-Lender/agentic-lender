import Foundation
import os

/// Calls `POST /ai/affordability` through the API gateway with the borrower's Firebase ID token,
/// for a mortgage or, with `loan_type: heloc`, a HELOC.
struct APIAffordabilityService: AffordabilityService, HELOCService {
    static let path = "ai/affordability"

    let baseURL: URL
    let session: URLSession
    /// The signed-in borrower's ID token, refreshed from Firebase when `forcingRefresh` is true;
    /// throws `AffordabilityError.signedOut` when there is none.
    let idToken: @Sendable (_ forcingRefresh: Bool) async throws -> String

    func calculate(_ request: AffordabilityRequest) async throws -> AffordabilityResult {
        try await post(request.body(), decode: AffordabilityResult.decode)
    }

    func checkHELOC(_ request: HELOCRequest) async throws -> HELOCResult {
        try await post(request.body(), decode: HELOCResult.decode)
    }

    /// A 401 can mean the cached ID token had only just expired, so the request is sent once more with a
    /// refreshed token before the borrower is told they're signed out (AL-262). Nothing else is retried.
    private func post<Result>(_ body: Data, decode: (Data) throws -> Result) async throws -> Result {
        do {
            do {
                return try await gateway(forcingRefresh: false).post(Self.path, body: body, decode: decode)
            } catch APIError.signedOut {
                return try await gateway(forcingRefresh: true).post(Self.path, body: body, decode: decode)
            }
        } catch let error as APIError {
            throw AffordabilityError(error)
        }
    }

    private func gateway(forcingRefresh: Bool) -> APIGateway {
        let idToken = idToken
        return APIGateway(
            baseURL: baseURL, session: session, idToken: { try await idToken(forcingRefresh) },
            logger: Logger(category: "Affordability")
        )
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
