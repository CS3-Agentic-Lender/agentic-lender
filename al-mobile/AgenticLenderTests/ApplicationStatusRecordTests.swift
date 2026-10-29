import XCTest
@testable import AgenticLender

/// Reading the status parts of `applications/{id}` (al-core SCHEMA.md) into the app's record (AL-102).
final class ApplicationStatusRecordTests: XCTestCase {
    private let created = Date(timeIntervalSince1970: 1_790_000_000)
    private let submitted = Date(timeIntervalSince1970: 1_790_086_400)
    private let decided = Date(timeIntervalSince1970: 1_790_345_600)

    func testReadsTheStatusDatesDecisionAndHistory() throws {
        let fields: [String: Any] = [
            "status": "Declined",
            "createdAt": created,
            "submittedAt": submitted,
            "decision": ["outcome": "declined", "decidedAt": decided, "reason": "  the deposit is below 10%  ", "underwriterId": "u1"],
            "statusHistory": [
                ["from": "Draft", "to": "Applied", "actor": "borrower", "actorId": "b1", "at": submitted],
                ["from": "AI Deliberated", "to": "Declined", "actor": "underwriter", "actorId": "u1", "at": decided],
            ],
            "loanAmountEur": 210_000,
        ]

        let record = try XCTUnwrap(ApplicationStatusRecord(fields: fields))

        XCTAssertEqual(record.status, .declined)
        XCTAssertEqual(record.createdAt, created)
        XCTAssertEqual(record.submittedAt, submitted)
        XCTAssertEqual(record.decision, .init(outcome: .declined, decidedAt: decided, reason: "the deposit is below 10%"))
        XCTAssertEqual(record.history, [.init(to: .applied, at: submitted), .init(to: .declined, at: decided)])
    }

    func testEveryAgreedStatusIsRead() {
        for status in ApplicationStatus.allCases {
            XCTAssertEqual(ApplicationStatusRecord(fields: ["status": status.rawValue])?.status, status)
        }
        XCTAssertEqual(ApplicationStatus.allCases.map(\.rawValue), [
            "Draft", "Applied", "AI Deliberated", "Underwriter Approved", "Declined", "Funded", "Closed",
        ])
    }

    func testAnUnknownOrMissingStatusIsNotARecord() {
        XCTAssertNil(ApplicationStatusRecord(fields: ["status": "Approved"]))
        XCTAssertNil(ApplicationStatusRecord(fields: ["status": "applied"]))
        XCTAssertNil(ApplicationStatusRecord(fields: [:]))
    }

    func testOptionalPartsCanBeMissing() throws {
        let record = try XCTUnwrap(ApplicationStatusRecord(fields: ["status": "Applied"]))

        XCTAssertNil(record.createdAt)
        XCTAssertNil(record.submittedAt)
        XCTAssertNil(record.decision)
        XCTAssertEqual(record.history, [])
    }

    func testABlankReasonCountsAsNone() throws {
        let fields: [String: Any] = ["status": "Declined", "decision": ["outcome": "declined", "reason": "   "]]

        XCTAssertNil(try XCTUnwrap(ApplicationStatusRecord(fields: fields)).decision?.reason)
    }

    func testADecisionTimeStoredAsTextIsRead() throws {
        let fields: [String: Any] = ["status": "Underwriter Approved", "decision": ["outcome": "approved", "decidedAt": "2026-09-24T10:15:30.250Z"]]

        let decision = try XCTUnwrap(ApplicationStatusRecord(fields: fields)?.decision)

        XCTAssertEqual(decision.outcome, .approved)
        XCTAssertEqual(decision.decidedAt, ISO8601DateFormatter.withFractions.date(from: "2026-09-24T10:15:30.250Z"))
    }

    func testHistoryEntriesThatCannotBeReadAreSkipped() throws {
        let fields: [String: Any] = [
            "status": "Applied",
            "statusHistory": [["to": "Applied", "at": submitted], ["to": "Somewhere", "at": submitted], ["to": "Applied"], "junk"],
        ]

        XCTAssertEqual(try XCTUnwrap(ApplicationStatusRecord(fields: fields)).history, [.init(to: .applied, at: submitted)])
    }

    func testEachStatusHasItsPaletteATone() {
        XCTAssertEqual(ApplicationStatus.allCases.map(\.tone), [.neutral, .neutral, .tint, .success, .danger, .success, .neutral])
    }
}

private extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
