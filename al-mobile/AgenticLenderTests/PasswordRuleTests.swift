import XCTest
@testable import AgenticLender

final class PasswordRuleTests: XCTestCase {
    func testExactlyEightCharactersMeetsTheLengthRule() {
        XCTAssertTrue(PasswordRule.minimumLength.isMet(by: "abcd1234"))
    }

    func testSevenCharactersIsTooShort() {
        XCTAssertFalse(PasswordRule.minimumLength.isMet(by: "abc1234"))
    }

    func testLettersOnlyHasNoNumber() {
        let password = TestFixtures.lettersOnlyPassword

        XCTAssertTrue(PasswordRule.containsLetter.isMet(by: password))
        XCTAssertFalse(PasswordRule.containsNumber.isMet(by: password))
        XCTAssertFalse(PasswordRule.allMet(by: password))
    }

    func testNumbersOnlyHasNoLetter() {
        let password = TestFixtures.numbersOnlyPassword

        XCTAssertFalse(PasswordRule.containsLetter.isMet(by: password))
        XCTAssertTrue(PasswordRule.containsNumber.isMet(by: password))
        XCTAssertFalse(PasswordRule.allMet(by: password))
    }

    func testEightCharactersWithALetterAndANumberMeetsEveryRule() {
        XCTAssertTrue(PasswordRule.allMet(by: "abcdefg1"))
        XCTAssertTrue(PasswordRule.allMet(by: "1234567a"))
    }

    func testOnlyTheDigitsZeroToNineCountAsANumber() {
        // Arabic-Indic three and a full-width one are numbers to Swift, but not 0 to 9.
        XCTAssertFalse(PasswordRule.containsNumber.isMet(by: "abcdefg\u{0663}"))
        XCTAssertFalse(PasswordRule.containsNumber.isMet(by: "abcdefg\u{FF11}"))
        XCTAssertTrue(PasswordRule.containsNumber.isMet(by: "abcdefg7"))
    }

    func testEmptyPasswordMeetsNoRule() {
        for rule in PasswordRule.allCases {
            XCTAssertFalse(rule.isMet(by: ""), "\(rule)")
        }
    }

    func testRulesAreListedInTheOrderShownUnderTheField() {
        XCTAssertEqual(
            PasswordRule.allCases.map(\.label),
            ["At least 8 characters", "Contains a letter", "Contains a number"]
        )
    }
}
