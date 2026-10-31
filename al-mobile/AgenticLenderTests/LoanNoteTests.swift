import XCTest
@testable import AgenticLender

/// The loan note section on the status screen (Figma 14c), read from the application record as
/// al-core's mint endpoint writes it: `loanNote` (`tokenId`, `txHash`, `mintedAt`) next to
/// `loanAmountEur`, `aprPct` and `termYears`.
final class LoanNoteTests: XCTestCase {
    private let dublin = TimeZone(identifier: "Europe/Dublin")!
    /// 3 Oct 2026, 14:05 in Dublin.
    private let mintedAt = Date(timeIntervalSince1970: 1_791_032_700)

    private func record(status: String = "Funded", _ extra: [String: Any]) throws -> ApplicationStatusRecord {
        try XCTUnwrap(ApplicationStatusRecord(fields: ["status": status].merging(extra) { $1 }))
    }

    private var minted: [String: Any] {
        [
            "loanAmountEur": 210_000,
            "aprPct": 3.45,
            "termYears": 30,
            "loanNote": ["tokenId": "42", "txHash": "0xabc123", "mintedAt": mintedAt, "contractAddress": "0xdef"],
        ]
    }

    // MARK: - Criterion 1: Funded shows token ID, principal, APR, term and mint date

    func testAMintedNoteShowsItsFiveRowsAsIn14c() throws {
        let note = try XCTUnwrap(try record(minted).loanNote)

        XCTAssertEqual(note.rows(timeZone: dublin), [
            LoanNote.Row(title: "Token ID", value: "#42"),
            LoanNote.Row(title: "Principal", value: "€210,000"),
            LoanNote.Row(title: "APR", value: "3.45%"),
            LoanNote.Row(title: "Term", value: "30 years"),
            LoanNote.Row(title: "Mint date", value: "3 Oct 2026"),
        ])
    }

    func testAWholeOrOneDecimalRateKeepsOneDecimal() throws {
        var fields = minted
        fields["aprPct"] = 4
        XCTAssertEqual(try record(fields).loanNote?.rows(timeZone: dublin)[2].value, "4.0%")
        fields["aprPct"] = 3.5
        XCTAssertEqual(try record(fields).loanNote?.rows(timeZone: dublin)[2].value, "3.5%")
    }

    func testWithoutAnOfferedRateTheBenchmarkRateTheNoteWasMintedWithShows() throws {
        var fields = minted
        fields["aprPct"] = nil
        fields["dtiBreakdown"] = ["benchmarkRatePct": 4.1]

        XCTAssertEqual(try record(fields).loanNote?.rows(timeZone: dublin)[2].value, "4.1%")
    }

    func testAMintDateWrittenAsTextIsRead() throws {
        var fields = minted
        fields["loanNote"] = ["tokenId": "7", "txHash": "0x1", "mintedAt": "2026-10-03T13:05:00Z"]

        XCTAssertEqual(try record(fields).loanNote?.rows(timeZone: dublin).last?.value, "3 Oct 2026")
    }

    func testAMissingFigureShowsADash() throws {
        let note = try XCTUnwrap(try record(["loanNote": ["tokenId": "9"]]).loanNote)

        XCTAssertEqual(note.rows(timeZone: dublin).map(\.value), ["#9", "—", "—", "—", "—"])
    }

    func testAOneYearTermIsSingular() throws {
        var fields = minted
        fields["termYears"] = 1
        XCTAssertEqual(try record(fields).loanNote?.rows(timeZone: dublin)[3].value, "1 year")
    }

    func testANoteWithNoTokenIDIsNotANote() throws {
        XCTAssertNil(try record(["loanNote": ["txHash": "0xabc"]]).loanNote)
        XCTAssertNil(try record(["loanNote": "not a map"]).loanNote)
    }

    // MARK: - Criterion 2: the block explorer, or the transaction hash on the local chain

    func testWithAnExplorerSetTheLinkOpensTheMintTransaction() throws {
        let note = try XCTUnwrap(try record(minted).loanNote)

        XCTAssertEqual(
            note.explorerURL(transactionBase: "https://amoy.polygonscan.com/tx/"),
            URL(string: "https://amoy.polygonscan.com/tx/0xabc123")
        )
    }

    func testOnTheLocalChainThereIsNoLinkSoTheHashShows() throws {
        let note = try XCTUnwrap(try record(minted).loanNote)

        XCTAssertNil(note.explorerURL(transactionBase: nil))
        XCTAssertEqual(note.transactionHash, "0xabc123")
    }

    func testWithNoTransactionHashThereIsNoLink() throws {
        let note = try XCTUnwrap(try record(["loanNote": ["tokenId": "9"]]).loanNote)

        XCTAssertNil(note.explorerURL(transactionBase: "https://amoy.polygonscan.com/tx/"))
    }

    func testTheExplorerAddressComesFromTheEnvironment() {
        XCTAssertEqual(
            BackendConfig(environment: ["BLOCK_EXPLORER_TX_URL": " https://amoy.polygonscan.com/tx/ "]).blockExplorerTxURL,
            "https://amoy.polygonscan.com/tx/"
        )
        XCTAssertNil(BackendConfig(environment: [:]).blockExplorerTxURL, "the local chain has no explorer")
        XCTAssertNil(BackendConfig(environment: ["BLOCK_EXPLORER_TX_URL": "  "]).blockExplorerTxURL)
    }

    // MARK: - Criterion 3: before Funded, the waiting line

    func testBeforeMintingTheSectionWaits() throws {
        for status in ["Applied", "AI Deliberated", "Underwriter Approved"] {
            XCTAssertEqual(LoanNoteSection(record: try record(status: status, [:])), .waiting, status)
        }
        XCTAssertEqual(
            LoanNoteSection.waitingText,
            "Your loan note will appear here once the bank approves and funds your loan"
        )
    }

    func testOnceMintedTheSectionShowsTheNote() throws {
        let funded = try record(minted)

        XCTAssertEqual(LoanNoteSection(record: funded), .minted(try XCTUnwrap(funded.loanNote)))
    }

    func testADraftOrADeclinedApplicationHasNoSection() throws {
        XCTAssertEqual(LoanNoteSection(record: try record(status: "Draft", [:])), .hidden)
        XCTAssertEqual(LoanNoteSection(record: try record(status: "Declined", [:])), .hidden)
        XCTAssertEqual(LoanNoteSection(record: try record(status: "Closed", [:])), .hidden, "closed without a note")
    }
}
