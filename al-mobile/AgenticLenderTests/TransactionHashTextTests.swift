import UIKit
import XCTest
@testable import AgenticLender

/// AL-285: the mint transaction hash wraps without adding a hyphen, and what is shown is exactly the stored hash.
@MainActor
final class TransactionHashTextTests: XCTestCase {
    private let txHash = "0x892967fbc11bd6669f894d0e1b7d4c3a8f6e2d1c0b9a8f7e6d5c4b3a2f1e0d9c"

    func testShowsExactlyTheStoredHash() {
        let view = TransactionHashText.makeTextView(txHash)

        XCTAssertEqual(view.text, txHash)
        XCTAssertEqual(view.attributedText.string, txHash)
        XCTAssertEqual(view.accessibilityValue, txHash)
    }

    func testWrapsAtAnyCharacterWithoutHyphenating() throws {
        let view = TransactionHashText.makeTextView(txHash)

        let style = try XCTUnwrap(view.attributedText.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(style.hyphenationFactor, 0)
        XCTAssertFalse(style.usesDefaultHyphenation)
        XCTAssertEqual(style.lineBreakMode, .byCharWrapping)
    }

    func testCanBeSelectedButNotEdited() {
        let view = TransactionHashText.makeTextView(txHash)

        XCTAssertTrue(view.isSelectable)
        XCTAssertFalse(view.isEditable)
        XCTAssertFalse(view.isScrollEnabled)
    }

    func testWrapsOntoMoreLinesWhenNarrow() {
        let view = TransactionHashText.makeTextView(txHash)

        let wide = view.sizeThatFits(CGSize(width: 2000, height: CGFloat.greatestFiniteMagnitude)).height
        let narrow = view.sizeThatFits(CGSize(width: 200, height: CGFloat.greatestFiniteMagnitude)).height

        XCTAssertGreaterThan(narrow, wide)
    }
}
