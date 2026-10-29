import Foundation

/// The "My application" timeline (AL-102, Figma 14, 14a and 14b): one row per agreed step, in order.
///
/// Finished steps are ticked with the date they were reached; the current step has a badge in its
/// palette A tone and a line saying what is happening. A declined application ends at the decision
/// (it never reaches Funded), with the reason when the underwriter gave one.
struct StatusTimeline: Equatable {
    enum Mark: Equatable {
        case done
        case current
        case upcoming
        case declined
    }

    struct Badge: Equatable {
        let text: String
        let tone: StatusTone
    }

    struct Step: Equatable {
        let title: String
        let mark: Mark
        /// When a finished step was reached, e.g. "21 Sep". Nil when nothing stored it.
        let date: String?
        /// The line under the current step, or under a declined decision.
        let detail: String?
        /// Only on the current step.
        let badge: Badge?
    }

    let steps: [Step]

    /// The rows of the timeline, in order. The decision row stands for both Approved and Declined.
    private enum Kind: CaseIterable {
        case draft, applied, aiDeliberated, decision, funded, closed

        var order: Int { Kind.allCases.firstIndex(of: self)! }
    }

    init(record: ApplicationStatusRecord, timeZone: TimeZone = .current) {
        let dates = StepDates(record: record, timeZone: timeZone)
        let declined = record.status == .declined
            || record.decision?.outcome == .declined
            || record.history.contains { $0.to == .declined }
        let kinds = Kind.allCases.filter { !(declined && $0 == .funded) }
        let currentOrder = Self.order(of: record.status)

        steps = kinds.map { kind in
            let isCurrent = kind.order == currentOrder
            let isDeclinedDecision = kind == .decision && declined
            let mark: Mark = isDeclinedDecision && kind.order <= currentOrder ? .declined
                : isCurrent ? .current
                : kind.order < currentOrder ? .done
                : .upcoming
            let finished = mark == .done
            return Step(
                title: Self.title(of: kind, decided: currentOrder >= Kind.decision.order),
                mark: mark,
                date: finished ? dates.text(for: kind) : nil,
                detail: isCurrent || isDeclinedDecision && mark == .declined
                    ? Self.detail(of: kind, record: record, date: dates.text(for: kind), declined: declined)
                    : nil,
                badge: isCurrent ? Self.badge(for: record.status) : nil
            )
        }
    }

    private static func order(of status: ApplicationStatus) -> Int {
        switch status {
        case .draft: Kind.draft.order
        case .applied: Kind.applied.order
        case .aiDeliberated: Kind.aiDeliberated.order
        case .underwriterApproved, .declined: Kind.decision.order
        case .funded: Kind.funded.order
        case .closed: Kind.closed.order
        }
    }

    private static func title(of kind: Kind, decided: Bool) -> String {
        switch kind {
        case .draft: ApplicationStatus.draft.rawValue
        case .applied: ApplicationStatus.applied.rawValue
        case .aiDeliberated: ApplicationStatus.aiDeliberated.rawValue
        case .decision: decided ? "Underwriter decision" : "Underwriter Approved or Declined"
        case .funded: ApplicationStatus.funded.rawValue
        case .closed: ApplicationStatus.closed.rawValue
        }
    }

    /// "Now" in the status's tone, except where the badge itself says what happened.
    private static func badge(for status: ApplicationStatus) -> Badge {
        switch status {
        case .underwriterApproved: Badge(text: "Approved", tone: status.tone)
        case .declined: Badge(text: "Declined", tone: status.tone)
        case .closed: Badge(text: "Closed", tone: status.tone)
        default: Badge(text: "Now", tone: status.tone)
        }
    }

    private static func detail(of kind: Kind, record: ApplicationStatusRecord, date: String?, declined: Bool) -> String? {
        switch kind {
        case .draft:
            return "Not submitted yet"
        case .applied:
            return date.map { "Submitted \($0) · the AI credit committee is reviewing it" }
                ?? "The AI credit committee is reviewing it"
        case .aiDeliberated:
            return "AI review done\(date.map { " \($0)" } ?? "") · waiting for the underwriter"
        case .decision where declined:
            if let reason = record.decision?.reason {
                return [date, "Reason: \(reason)"].compactMap { $0 }.joined(separator: " · ")
            }
            return date.map { "Declined \($0)" }
        case .decision:
            return "Approved\(date.map { " \($0)" } ?? "") · waiting for the loan note to be minted"
        case .funded:
            return "Loan note minted\(date.map { " \($0)" } ?? "")"
        case .closed:
            return "Closed\(date.map { " \($0)" } ?? "")"
        }
    }

    /// When each step was reached: from `statusHistory` when it has the move, otherwise from the
    /// application's own times (created, submitted, decided). Nothing else stores a time.
    private struct StepDates {
        let record: ApplicationStatusRecord
        let formatter: DateFormatter

        init(record: ApplicationStatusRecord, timeZone: TimeZone) {
            self.record = record
            formatter = DateFormatter()
            // POSIX so September is always "Sep", whatever the phone's language settings.
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = timeZone
            formatter.dateFormat = "d MMM"
        }

        func text(for kind: Kind) -> String? {
            date(for: kind).map(formatter.string(from:))
        }

        private func date(for kind: Kind) -> Date? {
            let reached = record.history.last { move in statuses(of: kind).contains(move.to) }?.at
            switch kind {
            case .draft: return record.createdAt
            case .applied: return reached ?? record.submittedAt
            case .decision: return reached ?? record.decision?.decidedAt
            case .aiDeliberated, .funded, .closed: return reached
            }
        }

        private func statuses(of kind: Kind) -> [ApplicationStatus] {
            switch kind {
            case .draft: [.draft]
            case .applied: [.applied]
            case .aiDeliberated: [.aiDeliberated]
            case .decision: [.underwriterApproved, .declined]
            case .funded: [.funded]
            case .closed: [.closed]
            }
        }
    }
}
