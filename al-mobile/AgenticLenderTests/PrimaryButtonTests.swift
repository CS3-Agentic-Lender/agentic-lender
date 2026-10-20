import SwiftUI
import XCTest
@testable import AgenticLender

final class PrimaryButtonTests: XCTestCase {
    func testAnEnabledButtonIsPineWithSurfaceText() {
        let colours = PrimaryButton.colours(isEnabled: true, isLoading: false, isPressed: false)

        XCTAssertEqual(colours.background, Theme.pine)
        XCTAssertEqual(colours.foreground, Theme.surface)
    }

    func testAPressedButtonIsPinePressed() {
        let colours = PrimaryButton.colours(isEnabled: true, isLoading: false, isPressed: true)

        XCTAssertEqual(colours.background, Theme.pinePressed)
    }

    func testADisabledButtonIsLineWithMutedText() {
        let colours = PrimaryButton.colours(isEnabled: false, isLoading: false, isPressed: false)

        XCTAssertEqual(colours.background, Theme.line)
        XCTAssertEqual(colours.foreground, Theme.mutedText)
    }

    func testALoadingButtonStaysPineSoItsSpinnerShows() {
        let colours = PrimaryButton.colours(isEnabled: false, isLoading: true, isPressed: false)

        XCTAssertEqual(colours.background, Theme.pine)
        XCTAssertEqual(colours.foreground, Theme.surface)
    }
}
