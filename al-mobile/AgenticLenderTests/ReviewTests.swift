import XCTest
@testable import AgenticLender

/// Rating the app (AL-150, Figma 22 to 22c) and saving it with `PUT /core/reviews/me`
/// (al-core: rating a whole number 1 to 5, comment optional up to 500, blank comes back null).
@MainActor
final class ReviewTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:8000")!
    private let saved = ISO8601DateFormatter().date(from: "2026-09-29T15:10:00Z")!
    private let comment = "Clear and quick. I'd like to see the valuer's report in the app."

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    // MARK: - Criteria 1 and 3: stars, the comment limit and Submit

    func testSubmitIsDisabledUntilAStarIsChosen() {
        var form = ReviewForm()
        XCTAssertFalse(form.canSubmit)
        XCTAssertEqual(form.ratingText, "Tap a star to rate")

        form.rating = 4

        XCTAssertTrue(form.canSubmit)
        XCTAssertEqual(form.ratingText, "4 out of 5")
    }

    func testTheCommentIsOptionalButLimitedTo500Characters() {
        var form = ReviewForm(rating: 5, comment: "")
        XCTAssertTrue(form.canSubmit)

        form.comment = String(repeating: "a", count: ReviewForm.maxCommentLength)
        XCTAssertTrue(form.canSubmit)
        XCTAssertEqual(form.commentCount, "500 / 500")

        form.comment += "a"
        XCTAssertFalse(form.canSubmit)
        XCTAssertEqual(form.commentError, "Keep the comment to 500 characters")
    }

    func testTheBodyHasTheRatingAndTrimmedCommentOrNone() throws {
        let withComment = try JSONSerialization.jsonObject(
            with: XCTUnwrap(ReviewForm(rating: 4, comment: "  Great  ").body())
        ) as? [String: Any]
        let without = try JSONSerialization.jsonObject(with: XCTUnwrap(ReviewForm(rating: 2, comment: "  ").body())) as? [String: Any]

        XCTAssertEqual(withComment?["rating"] as? Int, 4)
        XCTAssertEqual(withComment?["comment"] as? String, "Great")
        XCTAssertEqual(without?["rating"] as? Int, 2)
        XCTAssertNil(without?["comment"])
        XCTAssertNil(ReviewForm().body())
    }

    // MARK: - PUT /core/reviews/me

    func testSavesWithPutAndReadsTheStoredReview() async throws {
        StubURLProtocol.response = (200, #"""
        {"rating": 4, "comment": "Great", "created_at": "2026-09-29T15:10:00.123Z", "updated_at": "2026-11-16T20:00:00Z"}
        """#)
        let api = APIReviewService(baseURL: baseURL, session: StubURLProtocol.session, idToken: { "test-token" }, uid: { "borrower1" })

        let review = try await api.save(XCTUnwrap(ReviewForm(rating: 4, comment: "Great").body()))

        let sent = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(sent.httpMethod, "PUT")
        XCTAssertEqual(sent.url?.absoluteString, "http://localhost:8000/core/reviews/me")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertEqual(review.rating, 4)
        XCTAssertEqual(review.comment, "Great")
        XCTAssertEqual(review.createdAt, ISO8601Timestamp.date(from: "2026-09-29T15:10:00.123Z"))
    }

    func testABlankCommentComesBackAsNone() throws {
        let review = try APIReviewService.decode(Data(#"{"rating": 3, "comment": null, "created_at": null, "updated_at": null}"#.utf8))

        XCTAssertEqual(review, SavedReview(rating: 3, comment: nil, createdAt: nil))
    }

    // MARK: - Criterion 2: thanks, then Edit review with the saved values (Figma 22b, 22c)

    func testANewBorrowerStartsWithAnEmptyForm() async {
        let model = ReviewViewModel(service: FakeReviewService(existing: nil))

        await model.load()

        XCTAssertEqual(model.state, .editing)
        XCTAssertEqual(model.form, ReviewForm())
        XCTAssertNil(model.reviewedOn)
        XCTAssertEqual(model.submitTitle, "Submit review")
    }

    func testABorrowerWhoReviewedBeforeSeesTheirReviewToUpdate() async {
        let model = ReviewViewModel(service: FakeReviewService(existing: SavedReview(rating: 4, comment: comment, createdAt: saved)))

        await model.load()

        XCTAssertEqual(model.form, ReviewForm(rating: 4, comment: comment))
        XCTAssertEqual(model.reviewedOn, "You reviewed on 29 Sep")
        XCTAssertEqual(model.submitTitle, "Update review")
    }

    func testSubmittingShowsThanksAndEditReopensWithTheSavedValues() async {
        let service = FakeReviewService(existing: nil)
        service.saveResult = .success(SavedReview(rating: 4, comment: comment, createdAt: saved))
        let model = ReviewViewModel(service: service)
        await model.load()
        model.form = ReviewForm(rating: 4, comment: comment)

        await model.submit()
        XCTAssertEqual(model.state, .thanks(SavedReview(rating: 4, comment: comment, createdAt: saved)))

        model.edit()
        XCTAssertEqual(model.state, .editing)
        XCTAssertEqual(model.form, ReviewForm(rating: 4, comment: comment))
        XCTAssertEqual(model.submitTitle, "Update review")
    }

    func testAFailedSubmitKeepsTheReviewAndSaysSo() async {
        let service = FakeReviewService(existing: nil)
        service.saveResult = .failure(.network)
        let model = ReviewViewModel(service: service)
        await model.load()
        model.form = ReviewForm(rating: 2, comment: "Slow")

        await model.submit()

        XCTAssertEqual(model.state, .failed("We couldn't save your review. Check your connection and try again."))
        XCTAssertEqual(model.form, ReviewForm(rating: 2, comment: "Slow"))
    }

    func testIfTheSavedReviewCantLoadTheFormStillOpensEmpty() async {
        let service = FakeReviewService(existing: nil)
        service.loadFails = true
        let model = ReviewViewModel(service: service)

        await model.load()

        XCTAssertEqual(model.state, .editing)
        XCTAssertEqual(model.form, ReviewForm())
    }
}

/// Answers with a fixed saved review and save result.
@MainActor
final class FakeReviewService: ReviewService {
    let existing: SavedReview?
    var loadFails = false
    var saveResult: Result<SavedReview, APIError> = .failure(.unavailable)

    init(existing: SavedReview?) {
        self.existing = existing
    }

    func load() async throws -> SavedReview? {
        if loadFails { throw APIError.unavailable }
        return existing
    }

    func save(_ body: Data) async throws -> SavedReview {
        try saveResult.get()
    }
}
