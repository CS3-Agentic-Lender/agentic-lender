import XCTest
@testable import AgenticLender

/// The `POST /ai/affordability` contract agreed with Nic on AL-57 (comment 10349).
final class AffordabilityResultTests: XCTestCase {
    func testDecodesTheReferenceCaseOneResponse() throws {
        let json = """
        {"max_loan_eur": 240000, "max_property_price_eur": 280000, "monthly_repayment_eur": 1145.80,
         "stressed_repayment_eur": 1438.92, "limited_by": "income", "benchmark_rate_pct": 4.0,
         "stressed_rate_pct": 6.0, "rate_date": "2026-08"}
        """

        let result = try AffordabilityResult.decode(Data(json.utf8))

        XCTAssertEqual(result.maxLoanEur, 240_000)
        XCTAssertEqual(result.maxPropertyPriceEur, 280_000)
        XCTAssertEqual(result.monthlyRepaymentEur, 1145.80)
        XCTAssertEqual(result.stressedRepaymentEur, 1438.92)
        XCTAssertEqual(result.limitedBy, .income)
        XCTAssertEqual(result.benchmarkRatePct, 4.0)
        XCTAssertEqual(result.stressedRatePct, 6.0)
        XCTAssertEqual(result.rateDate, "2026-08")
    }

    func testDecodesEachLimit() throws {
        for (raw, limit) in [("income", AffordabilityResult.Limit.income), ("deposit", .deposit), ("debts", .debts)] {
            let result = try AffordabilityResult.decode(Data(TestFixtures.affordabilityJSON(limitedBy: raw).utf8))
            XCTAssertEqual(result.limitedBy, limit)
        }
    }

    func testAnUnknownLimitIsADecodingError() {
        let data = Data(TestFixtures.affordabilityJSON(limitedBy: "equity").utf8)

        XCTAssertThrowsError(try AffordabilityResult.decode(data))
    }

    func testSingleRequestBodyUsesTheAgreedFieldNames() throws {
        let request = try XCTUnwrap(AffordabilityRequest(form: TestFixtures.affordabilityForm(income: "60,000", deposit: "40,000")))

        let body = try JSONSerialization.jsonObject(with: request.body()) as? [String: Any]

        XCTAssertEqual(body?["gross_income_eur"] as? Int, 60_000)
        XCTAssertEqual(body?["monthly_debts_eur"] as? Int, 0)
        XCTAssertEqual(body?["deposit_eur"] as? Int, 40_000)
        XCTAssertEqual(body?["term_years"] as? Int, 30)
        XCTAssertEqual(body?["first_time_buyer"] as? Bool, true)
        XCTAssertEqual(body?.count, 5)
    }

    func testJointRequestSendsOneHouseholdIncome() throws {
        var form = TestFixtures.affordabilityForm(income: "50,000", deposit: "30,000")
        form.applicants = .joint
        form.secondIncome = "40,000"
        form.isFirstTimeBuyer = false
        let request = try XCTUnwrap(AffordabilityRequest(form: form))

        let body = try JSONSerialization.jsonObject(with: request.body()) as? [String: Any]

        XCTAssertEqual(body?["gross_income_eur"] as? Int, 90_000)
        XCTAssertEqual(body?["first_time_buyer"] as? Bool, false)
    }
}
