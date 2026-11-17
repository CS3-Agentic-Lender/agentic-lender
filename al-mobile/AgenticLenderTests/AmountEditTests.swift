import XCTest
@testable import AgenticLender

/// AL-318: each keystroke in an amount field regroups at once, and the cursor stays where the borrower is typing.
final class AmountEditTests: XCTestCase {
    /// Types `characters` one at a time at the end, as a fast typist would.
    private func typed(_ characters: String) -> EuroAmount.Edit {
        var edit = EuroAmount.Edit(text: "", caret: 0)
        for character in characters {
            edit = EuroAmount.edit(edit.text, replacing: NSRange(location: edit.caret, length: 0), with: String(character))
        }
        return edit
    }

    func testTypingAWholeAmountGroupsItWithTheCursorAtTheEnd() {
        XCTAssertEqual(typed("2100000"), EuroAmount.Edit(text: "2,100,000", caret: 9))
    }

    func testEveryKeystrokeIsGroupedOnItsOwn() {
        XCTAssertEqual(typed("2100").text, "2,100")
        XCTAssertEqual(typed("21000").text, "21,000")
    }

    func testDeletingTheLastDigitRegroups() {
        let edit = EuroAmount.edit("2,100,000", replacing: NSRange(location: 8, length: 1), with: "")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "210,000", caret: 7))
    }

    func testTypingInTheMiddleKeepsTheCursorAfterTheNewDigit() {
        // "21|0,000" + "0" → "2,10|0,000": three digits before the cursor, as before the regroup.
        let edit = EuroAmount.edit("210,000", replacing: NSRange(location: 2, length: 0), with: "0")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "2,100,000", caret: 4))
    }

    func testDeletingAMiddleDigitKeepsTheCursorInPlace() {
        // "2,10|0,000" ← delete "0" → "210,000" with the cursor after "21" (2 digits before it).
        let edit = EuroAmount.edit("2,100,000", replacing: NSRange(location: 3, length: 1), with: "")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "210,000", caret: 2))
    }

    func testBackspaceOnASeparatorDeletesTheDigitBeforeIt() {
        // "2,|100" ← backspace: the comma alone would come straight back, so the "2" goes instead.
        let edit = EuroAmount.edit("2,100", replacing: NSRange(location: 1, length: 1), with: "")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "100", caret: 0))
    }

    func testClearingTheFieldLeavesItEmpty() {
        let edit = EuroAmount.edit("2,100", replacing: NSRange(location: 0, length: 5), with: "")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "", caret: 0))
    }

    func testTextThatIsNotADigitIsLeftAsTypedSoItsErrorCanShow() {
        let edit = EuroAmount.edit("12", replacing: NSRange(location: 2, length: 0), with: "a")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "12a", caret: 3))
    }

    func testPastingAnAmountGroupsIt() {
        let edit = EuroAmount.edit("", replacing: NSRange(location: 0, length: 0), with: "€ 60000")
        XCTAssertEqual(edit, EuroAmount.Edit(text: "60,000", caret: 6))
    }
}
