import XCTest
@testable import AgenticLender

final class BrokerTests: XCTestCase {
    func testDecodesTheBrokerListFromCore() throws {
        let json = #"[{"uid": "broker1", "name": "Bob Murphy", "firm": "Murphy Mortgages"}, {"uid": "broker3", "name": "aidan Walsh", "firm": null}]"#

        let brokers = try JSONDecoder().decode([Broker].self, from: Data(json.utf8))

        XCTAssertEqual(brokers, [.bob, Broker(uid: "broker3", name: "aidan Walsh", firm: nil)])
    }

    func testInitialsAreTheFirstLettersOfTheFirstAndLastNames() {
        XCTAssertEqual(Broker.bob.initials, "BM")
        XCTAssertEqual(Broker(uid: "b", name: "aidan Walsh", firm: nil).initials, "AW")
        XCTAssertEqual(Broker(uid: "b", name: "  Seán  Ó Briain ", firm: nil).initials, "SB")
        XCTAssertEqual(Broker(uid: "b", name: "Cher", firm: nil).initials, "C")
        XCTAssertEqual(Broker(uid: "b", name: nil, firm: nil).initials, "")
    }
}
