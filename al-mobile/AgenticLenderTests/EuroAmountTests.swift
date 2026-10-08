import XCTest
@testable import AgenticLender

final class EuroAmountTests: XCTestCase {
    func testParsesWholeEurosWithOrWithoutSeparators() {
        XCTAssertEqual(EuroAmount.parse("60000"), 60_000)
        XCTAssertEqual(EuroAmount.parse("60,000"), 60_000)
        XCTAssertEqual(EuroAmount.parse(" € 1,234,567 "), 1_234_567)
        XCTAssertEqual(EuroAmount.parse("0"), 0)
    }

    func testRejectsTextThatIsNotAWholeAmount() {
        for text in ["", "  ", "-5", "12.50", "abc", "1,2a"] {
            XCTAssertNil(EuroAmount.parse(text), text)
        }
    }

    func testFormatsWithThousandsSeparators() {
        XCTAssertEqual(EuroAmount.format(0), "0")
        XCTAssertEqual(EuroAmount.format(250), "250")
        XCTAssertEqual(EuroAmount.format(60_000), "60,000")
        XCTAssertEqual(EuroAmount.format(10_000_000), "10,000,000")
    }

    func testRegroupsDigitsAsTheBorrowerTypes() {
        XCTAssertEqual(EuroAmount.regroup("6000"), "6,000")
        XCTAssertEqual(EuroAmount.regroup("6,0000"), "60,000")
        XCTAssertEqual(EuroAmount.regroup(""), "")
    }

    func testLeavesTextWithOtherCharactersAloneSoTheErrorCanShow() {
        XCTAssertEqual(EuroAmount.regroup("-5"), "-5")
        XCTAssertEqual(EuroAmount.regroup("12.50"), "12.50")
    }
}
