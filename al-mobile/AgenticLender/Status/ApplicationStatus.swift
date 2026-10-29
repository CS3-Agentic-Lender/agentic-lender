import Foundation

/// The agreed application statuses, spelled exactly as al-core stores them (SCHEMA.md), so the app,
/// the portal and the backend share one list.
enum ApplicationStatus: String, CaseIterable, Sendable {
    case draft = "Draft"
    case applied = "Applied"
    case aiDeliberated = "AI Deliberated"
    case underwriterApproved = "Underwriter Approved"
    case declined = "Declined"
    case funded = "Funded"
    case closed = "Closed"

    /// Its badge tone from palette A (docs/infrastructure.md), the same as the portal's.
    var tone: StatusTone {
        switch self {
        case .draft, .applied, .closed: .neutral
        case .aiDeliberated: .tint
        case .underwriterApproved, .funded: .success
        case .declined: .danger
        }
    }
}

/// The palette A badge tones. The colours themselves are in `Theme`.
enum StatusTone: Hashable, Sendable {
    case neutral
    case tint
    case success
    case danger
}
