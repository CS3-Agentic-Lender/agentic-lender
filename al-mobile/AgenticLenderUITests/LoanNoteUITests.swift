import XCTest

/// AL-146: the loan note section on the status screen waits before minting, then fills in live when
/// the mint writes `loanNote` and moves the application to Funded, as al-core's mint endpoint does.
final class LoanNoteUITests: EndToEndTestCase {
    func testTheLoanNoteFillsInWhenTheApplicationIsFunded() async throws {
        let borrower = try testBorrower
        let applicationID = try await borrower.seedSubmittedApplication()
        try signIn()
        tap("home.applicationCard.viewStatus")

        let waiting = element("status.loanNote.waiting")
        app.swipeUp()
        XCTAssertTrue(waiting.waitForExistence(timeout: Self.timeout), "No waiting line before minting")
        XCTAssertEqual(waiting.label, "Loan note, Your loan note will appear here once the bank approves and funds your loan")
        keepScreenshot(named: "Before minting")

        try await mint(applicationID)

        let tokenRow = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == 'status.loanNote.row' AND label BEGINSWITH 'Token ID'"))
            .firstMatch
        XCTAssertTrue(tokenRow.waitForExistence(timeout: Self.timeout), "The loan note didn't appear")
        app.swipeUp()
        XCTAssertEqual(tokenRow.label, "Token ID, #42")
        XCTAssertTrue(element("status.loanNote.transaction").exists, "The local chain shows the mint transaction")
        keepScreenshot(named: "Funded, loan note minted")
    }

    /// What the mint endpoint writes in one go: the note, the status and its history entry.
    private func mint(_ applicationID: String) async throws {
        var url = URLComponents(url: EmulatorBackend.firestore("applications/\(applicationID)"), resolvingAgainstBaseURL: false)!
        url.queryItems = ["status", "statusHistory", "loanNote", "aprPct"].map {
            URLQueryItem(name: "updateMask.fieldPaths", value: $0)
        }
        let now = Date()
        try await EmulatorBackend.send("PATCH", url.url!, token: EmulatorBackend.ownerToken, json: ["fields": [
            "status": EmulatorBackend.value("Funded"),
            "statusHistory": EmulatorBackend.value([
                ["to": "Applied", "at": now.addingTimeInterval(-7200)],
                ["to": "Funded", "at": now],
            ]),
            "aprPct": ["doubleValue": 3.45],
            "loanNote": EmulatorBackend.value([
                "tokenId": "42",
                "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
                "txHash": "0x8c1f6e2a9b3d4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6",
                "auditHash": "0x" + String(repeating: "ab", count: 32),
                "mintedAt": now,
            ]),
        ]])
    }

    private func keepScreenshot(named name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
