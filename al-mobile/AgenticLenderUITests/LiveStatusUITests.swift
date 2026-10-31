import XCTest

/// AL-280 test 2: the status screen shows a status change written to Firestore within 5 seconds,
/// with no refresh.
final class LiveStatusUITests: EndToEndTestCase {
    /// The longest a written status may take to show (AL-280 criterion 2).
    private static let liveUpdateLimit: TimeInterval = 5

    func testStatusScreenShowsANewStatusWithoutARefresh() async throws {
        let borrower = try testBorrower
        let applicationID = try await borrower.seedSubmittedApplication()

        try signIn()
        tap("home.applicationCard.viewStatus")
        XCTAssertTrue(currentStep("Applied").waitForExistence(timeout: Self.timeout), "Applied isn't the current step")

        let now = Date()
        try await borrower.moveApplication(applicationID, to: "AI Deliberated", history: [
            ["to": "Applied", "at": now.addingTimeInterval(-3600)],
            ["to": "AI Deliberated", "at": now],
        ])

        XCTAssertTrue(
            currentStep("AI Deliberated").waitForExistence(timeout: Self.liveUpdateLimit),
            "AI Deliberated didn't show within \(Int(Self.liveUpdateLimit)) seconds"
        )
    }

    /// The timeline row for `title` when it is the current step; VoiceOver reads it "<title>, current step, …".
    /// Found by that label: the rows sit inside `status.timeline`, whose identifier covers theirs.
    private func currentStep(_ title: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "\(title), current step"))
            .firstMatch
    }
}
