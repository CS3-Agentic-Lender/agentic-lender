import XCTest
@testable import AgenticLender

/// The home types the app offers: the eight the valuation model is trained on
/// (Nic's data readiness report for the Daft.ie 2024 listings).
final class PropertyTypeTests: XCTestCase {
    func testOffersTheEightModelTypesWithTheModelsSpelling() {
        XCTAssertEqual(
            PropertyType.allCases.map(\.rawValue),
            ["Detached", "Semi-D", "Terrace", "End of Terrace", "Bungalow", "Apartment", "Duplex", "Townhouse"]
        )
    }

    func testTypesShowInPlainEnglish() {
        XCTAssertEqual(
            PropertyType.allCases.map(\.title),
            ["Detached", "Semi-detached", "Terraced", "End of terrace", "Bungalow", "Apartment", "Duplex", "Townhouse"]
        )
    }
}
