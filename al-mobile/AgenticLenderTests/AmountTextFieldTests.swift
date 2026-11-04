import XCTest
@testable import AgenticLender

/// AL-286: when the model's text comes back, the field keeps what is typed unless the change came from outside.
final class AmountTextFieldTests: XCTestCase {
    func testKeepsTheTypedTextWhenTheModelOnlyRegroupedIt() {
        // Typing fast: the model's regrouped copy of the last keystroke arrives before the field's own regroup.
        XCTAssertFalse(AmountTextField.replacesShown("21,00000", with: "2,100,000"))
        XCTAssertFalse(AmountTextField.replacesShown("6,0000", with: "60,000"))
    }

    func testKeepsTheTypedTextWhenItAlreadyMatches() {
        XCTAssertFalse(AmountTextField.replacesShown("2,100,000", with: "2,100,000"))
        XCTAssertFalse(AmountTextField.replacesShown("", with: ""))
    }

    func testShowsAChangeFromOutside() {
        // A saved check filling the form, or the form being cleared.
        XCTAssertTrue(AmountTextField.replacesShown("", with: "60,000"))
        XCTAssertTrue(AmountTextField.replacesShown("2,100,000", with: ""))
        XCTAssertTrue(AmountTextField.replacesShown("210,000", with: "45,000"))
    }
}
