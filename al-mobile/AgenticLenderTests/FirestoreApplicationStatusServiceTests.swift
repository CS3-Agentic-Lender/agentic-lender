import FirebaseFirestore
import XCTest
@testable import AgenticLender

/// Firestore hands back its own `Timestamp`, not `Date`, at every level of the application document.
/// These check the conversion the status screen relies on (AL-102).
final class FirestoreApplicationStatusServiceTests: XCTestCase {
    private let created = Date(timeIntervalSince1970: 1_790_000_000)
    private let submitted = Date(timeIntervalSince1970: 1_790_086_400)
    private let decided = Date(timeIntervalSince1970: 1_790_345_600)

    /// The document as Firestore returns it: timestamps at the top, in the decision map and in
    /// each history entry.
    private var documentFromFirestore: [String: Any] {
        [
            "status": "Declined",
            "createdAt": Timestamp(date: created),
            "submittedAt": Timestamp(date: submitted),
            "decision": ["outcome": "declined", "decidedAt": Timestamp(date: decided), "reason": "the deposit is below 10%"],
            "statusHistory": [
                ["from": "Draft", "to": "Applied", "at": Timestamp(date: submitted)],
                ["from": "AI Deliberated", "to": "Declined", "at": Timestamp(date: decided)],
            ],
            "loanAmountEur": 210_000,
        ]
    }

    func testTimestampsBecomeDatesAtEveryLevel() throws {
        let fields = FirestoreApplicationStatusService.withDates(documentFromFirestore)

        XCTAssertEqual(fields["createdAt"] as? Date, created)
        XCTAssertEqual(fields["submittedAt"] as? Date, submitted)
        let decision = try XCTUnwrap(fields["decision"] as? [String: Any])
        XCTAssertEqual(decision["decidedAt"] as? Date, decided)
        let history = try XCTUnwrap(fields["statusHistory"] as? [[String: Any]])
        XCTAssertEqual(history.map { $0["at"] as? Date }, [submitted, decided])
    }

    func testOtherValuesAreLeftAsTheyAre() {
        let fields = FirestoreApplicationStatusService.withDates(documentFromFirestore)

        XCTAssertEqual(fields["status"] as? String, "Declined")
        XCTAssertEqual(fields["loanAmountEur"] as? Int, 210_000)
        XCTAssertEqual((fields["decision"] as? [String: Any])?["reason"] as? String, "the deposit is below 10%")
    }

    func testAFirestoreDocumentReadsIntoTheSameRecordAsDates() throws {
        let record = try XCTUnwrap(ApplicationStatusRecord(fields: FirestoreApplicationStatusService.withDates(documentFromFirestore)))

        XCTAssertEqual(record.createdAt, created)
        XCTAssertEqual(record.submittedAt, submitted)
        XCTAssertEqual(record.decision?.decidedAt, decided)
        XCTAssertEqual(record.history, [.init(to: .applied, at: submitted), .init(to: .declined, at: decided)])
    }

    func testWithoutTheConversionTimestampsAreNotRead() {
        // Why the conversion matters: the record only reads `Date` or ISO text, so raw timestamps lose every date.
        let record = ApplicationStatusRecord(fields: documentFromFirestore)

        XCTAssertNil(record?.createdAt)
        XCTAssertEqual(record?.history, [])
    }
}
