import XCTest
@testable import AgenticLender

/// A saved property check as read from `users/{uid}/saved_checks` (al-core SCHEMA.md), and the row the
/// Properties list and the application form show for it (AL-144, Figma 09).
final class SavedCheckTests: XCTestCase {
    private let created = Date(timeIntervalSince1970: 1_793_000_000)

    private func fields(askingPrice: Double? = 379_000, needsReview: Bool? = true, gap: Double? = 0.0986) -> [String: Any] {
        var property: [String: Any] = [
            "county": "Cork", "eircode": "T12 X8Y2", "propertyType": "Semi-D",
            "bedrooms": 3, "floorAreaSqm": 110.0, "berRating": "B3",
        ]
        property["askingPriceEur"] = askingPrice
        var fields: [String: Any] = [
            "property": property, "estimatedValueEur": 345_210.5, "supportWarnings": [],
            "modelVersion": "v2", "createdAt": created,
        ]
        fields["priceNeedsReview"] = needsReview
        fields["askingPriceGap"] = gap
        return fields
    }

    func testReadsTheStoredCheck() throws {
        let check = try XCTUnwrap(SavedCheck(id: "c1", fields: fields()))

        XCTAssertEqual(check.id, "c1")
        XCTAssertEqual(check.county, .cork)
        XCTAssertEqual(check.eircode, "T12 X8Y2")
        XCTAssertEqual(check.propertyType, .semiDetached)
        XCTAssertEqual(check.bedrooms, 3)
        XCTAssertEqual(check.floorAreaM2, 110)
        XCTAssertEqual(check.berRating, .b3)
        XCTAssertEqual(check.askingPriceEur, 379_000)
        XCTAssertEqual(check.createdAt, created)
    }

    func testTheRowShowsTheNameDetailsEstimateAndVerdict() throws {
        let check = try XCTUnwrap(SavedCheck(id: "c1", fields: fields()))

        XCTAssertEqual(check.title, "Cork semi-detached")
        XCTAssertEqual(check.details, "Cork · Semi-detached · 3 bed")
        XCTAssertEqual(check.estimate, "€345,000")
        XCTAssertEqual(check.verdict, .overPriced)
    }

    func testAFairCheckAndOneWithNoAskingPrice() throws {
        let fair = try XCTUnwrap(SavedCheck(id: "c1", fields: fields(needsReview: false, gap: 0.02)))
        let noPrice = try XCTUnwrap(SavedCheck(id: "c2", fields: fields(askingPrice: nil, needsReview: nil, gap: nil)))

        XCTAssertEqual(fair.verdict, .fair)
        XCTAssertNil(noPrice.verdict)
        XCTAssertNil(noPrice.askingPriceEur)
    }

    func testFirestoreNumbersReadWhateverTheirType() throws {
        var stored = fields()
        var property = try XCTUnwrap(stored["property"] as? [String: Any])
        property["bedrooms"] = NSNumber(value: Int64(2))
        property["floorAreaSqm"] = NSNumber(value: 85)
        stored["property"] = property

        let check = try XCTUnwrap(SavedCheck(id: "c1", fields: stored))

        XCTAssertEqual(check.bedrooms, 2)
        XCTAssertEqual(check.floorAreaM2, 85)
    }

    func testACheckTheAppCannotPlaceIsSkipped() {
        for broken in ["county", "eircode", "propertyType", "bedrooms", "floorAreaSqm", "berRating"] {
            var stored = fields()
            var property = stored["property"] as! [String: Any]
            property[broken] = "not right"
            stored["property"] = property

            XCTAssertNil(SavedCheck(id: "c1", fields: stored), broken)
        }
        var noEstimate = fields()
        noEstimate["estimatedValueEur"] = nil
        XCTAssertNil(SavedCheck(id: "c1", fields: noEstimate))
    }
}
