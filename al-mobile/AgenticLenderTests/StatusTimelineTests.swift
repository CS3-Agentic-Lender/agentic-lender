import XCTest
@testable import AgenticLender

/// The application status timeline (AL-102, Figma 14, 14a and 14b).
final class StatusTimelineTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func day(_ text: String) -> Date {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: "\(text)T09:30:00Z")!
    }

    /// An application that moved through `path`, one day apart from 21 Sep, with every move in its history.
    private func record(
        _ status: ApplicationStatus, path: [ApplicationStatus]? = nil,
        reason: String? = nil, history: Bool = true
    ) -> ApplicationStatusRecord {
        let moves = (path ?? Self.path(to: status)).dropFirst().enumerated().map { index, to in
            ApplicationStatusRecord.Move(to: to, at: day("2026-09-\(22 + index)"))
        }
        let decided = moves.first { $0.to == .underwriterApproved || $0.to == .declined }
        return ApplicationStatusRecord(
            status: status,
            createdAt: day("2026-09-21"),
            submittedAt: moves.first { $0.to == .applied }?.at,
            decision: decided.map {
                .init(outcome: $0.to == .declined ? .declined : .approved, decidedAt: $0.at, reason: reason)
            },
            history: history ? Array(moves) : []
        )
    }

    private static func path(to status: ApplicationStatus) -> [ApplicationStatus] {
        let funded: [ApplicationStatus] = [.draft, .applied, .aiDeliberated, .underwriterApproved, .funded, .closed]
        let declined: [ApplicationStatus] = [.draft, .applied, .aiDeliberated, .declined]
        if status == .declined { return declined }
        return Array(funded.prefix(through: funded.firstIndex(of: status)!))
    }

    private func timeline(_ record: ApplicationStatusRecord) -> StatusTimeline {
        StatusTimeline(record: record, timeZone: utc)
    }

    private func marks(_ timeline: StatusTimeline) -> [StatusTimeline.Mark] {
        timeline.steps.map(\.mark)
    }

    // MARK: - Criterion 1: every status displays correctly

    func testADraftHasOnlyItsFirstStepUnderway() {
        let steps = timeline(record(.draft)).steps

        XCTAssertEqual(steps.map(\.title), [
            "Draft", "Applied", "AI Deliberated", "Underwriter Approved or Declined", "Funded", "Closed",
        ])
        XCTAssertEqual(steps.map(\.mark), [.current, .upcoming, .upcoming, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(steps[0].detail, "Not submitted yet")
    }

    func testAnAppliedApplicationIsWithTheAICommittee() {
        let steps = timeline(record(.applied)).steps

        XCTAssertEqual(steps.map(\.mark), [.done, .current, .upcoming, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(steps[1].detail, "Submitted 22 Sep · the AI credit committee is reviewing it")
    }

    func testAnAIDeliberatedApplicationWaitsForTheUnderwriter() {
        let steps = timeline(record(.aiDeliberated)).steps

        XCTAssertEqual(steps.map(\.mark), [.done, .done, .current, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(steps[2].detail, "AI review done 23 Sep · waiting for the underwriter")
    }

    func testAnApprovedApplicationWaitsForTheLoanNote() {
        let steps = timeline(record(.underwriterApproved)).steps

        XCTAssertEqual(steps[3].title, "Underwriter decision")
        XCTAssertEqual(steps.map(\.mark), [.done, .done, .done, .current, .upcoming, .upcoming])
        XCTAssertEqual(steps[3].badge, .init(text: "Approved", tone: .success))
        XCTAssertEqual(steps[3].detail, "Approved 24 Sep · waiting for the loan note to be minted")
    }

    func testADeclinedApplicationEndsAtTheDecision() {
        let steps = timeline(record(.declined, reason: "your repayments would take 44% of your income, above the 40% limit")).steps

        XCTAssertEqual(steps.map(\.title), ["Draft", "Applied", "AI Deliberated", "Underwriter decision", "Closed"])
        XCTAssertEqual(steps.map(\.mark), [.done, .done, .done, .declined, .upcoming])
        XCTAssertEqual(steps[3].badge, .init(text: "Declined", tone: .danger))
    }

    func testAFundedApplicationSaysTheLoanNoteIsMinted() {
        let steps = timeline(record(.funded)).steps

        XCTAssertEqual(steps.map(\.mark), [.done, .done, .done, .done, .current, .upcoming])
        XCTAssertEqual(steps[4].detail, "Loan note minted 25 Sep")
        XCTAssertEqual(steps[4].badge, .init(text: "Now", tone: .success))
    }

    func testAClosedApplicationHasEveryStepDone() {
        let steps = timeline(record(.closed)).steps

        XCTAssertEqual(steps.map(\.mark), [.done, .done, .done, .done, .done, .current])
        XCTAssertEqual(steps[5].badge, .init(text: "Closed", tone: .neutral))
        XCTAssertEqual(steps[5].detail, "Closed 26 Sep")
    }

    func testAClosedDeclinedApplicationKeepsItsDecisionAndSkipsFunded() {
        let path: [ApplicationStatus] = [.draft, .applied, .aiDeliberated, .declined, .closed]

        let steps = timeline(record(.closed, path: path, reason: "the deposit is below 10%")).steps

        XCTAssertEqual(steps.map(\.title), ["Draft", "Applied", "AI Deliberated", "Underwriter decision", "Closed"])
        XCTAssertEqual(steps.map(\.mark), [.done, .done, .done, .declined, .current])
        XCTAssertNil(steps[3].badge, "only the current step has a badge")
        XCTAssertEqual(steps[3].detail, "24 Sep · Reason: the deposit is below 10%")
    }

    // MARK: - Criterion 2: finished steps have their date; the current step uses its palette A colour

    func testFinishedStepsShowTheDateTheyWereReached() {
        let steps = timeline(record(.funded)).steps

        XCTAssertEqual(steps.map(\.date), ["21 Sep", "22 Sep", "23 Sep", "24 Sep", nil, nil])
    }

    func testOnlyTheCurrentStepHasABadgeInItsStatusColour() {
        let expected: [ApplicationStatus: StatusTimeline.Badge] = [
            .draft: .init(text: "Now", tone: .neutral),
            .applied: .init(text: "Now", tone: .neutral),
            .aiDeliberated: .init(text: "Now", tone: .tint),
            .underwriterApproved: .init(text: "Approved", tone: .success),
            .declined: .init(text: "Declined", tone: .danger),
            .funded: .init(text: "Now", tone: .success),
            .closed: .init(text: "Closed", tone: .neutral),
        ]

        for (status, badge) in expected {
            let badges = timeline(record(status)).steps.compactMap(\.badge)
            XCTAssertEqual(badges, [badge], "\(status)")
        }
    }

    func testWithoutAHistoryTheDatesComeFromTheApplicationItself() {
        // Seeded applications, and those moved before statusHistory existed, have no history.
        let steps = timeline(record(.declined, reason: nil, history: false)).steps

        XCTAssertEqual(steps[0].date, "21 Sep", "created")
        XCTAssertEqual(steps[1].date, "22 Sep", "submitted")
        XCTAssertNil(steps[2].date, "nothing stores when the AI review finished")
        XCTAssertEqual(steps[3].detail, "Declined 24 Sep", "decided")
    }

    func testTheCurrentStepStillReadsWellWithoutADate() {
        let noDates = ApplicationStatusRecord(status: .applied, createdAt: nil, submittedAt: nil, decision: nil, history: [])

        XCTAssertEqual(timeline(noDates).steps[1].detail, "The AI credit committee is reviewing it")
        XCTAssertNil(timeline(noDates).steps[0].date)
    }

    func testDatesAreShownInTheBorrowersTimeZone() {
        let lateEvening = ApplicationStatusRecord(
            status: .applied, createdAt: ISO8601DateFormatter().date(from: "2026-09-21T23:30:00Z"),
            submittedAt: nil, decision: nil, history: []
        )

        let dublin = StatusTimeline(record: lateEvening, timeZone: TimeZone(identifier: "Europe/Dublin")!)

        XCTAssertEqual(dublin.steps[0].date, "22 Sep")
    }

    // MARK: - Criterion 3: the decline reason shows only when one is given

    func testADeclineWithAReasonShowsIt() {
        let steps = timeline(record(.declined, reason: "your repayments would take 44% of your income, above the 40% limit")).steps

        XCTAssertEqual(steps[3].detail, "24 Sep · Reason: your repayments would take 44% of your income, above the 40% limit")
    }

    func testADeclineWithoutAReasonHasNoReasonLine() {
        let steps = timeline(record(.declined, reason: nil)).steps

        XCTAssertEqual(steps[3].detail, "Declined 24 Sep")
    }
}
