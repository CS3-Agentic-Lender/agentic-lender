/// Works out how much a borrower can borrow, through the affordability endpoint.
protocol AffordabilityService: Sendable {
    func calculate(_ request: AffordabilityRequest) async throws -> AffordabilityResult
}

/// Why a calculation failed, with a message the borrower can act on (Figma 07d "Couldn't calculate").
enum AffordabilityError: Error, Equatable {
    case network
    case signedOut
    case unavailable

    var message: String {
        switch self {
        case .network:
            "We couldn't calculate right now. Check your connection and try again."
        case .signedOut:
            "You've been signed out. Sign in again to calculate."
        case .unavailable:
            "We couldn't calculate right now. Try again in a moment."
        }
    }
}
