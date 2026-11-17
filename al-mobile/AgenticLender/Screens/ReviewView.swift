import SwiftUI

/// Rate Agentic Lender (AL-150, Figma 22 to 22c): stars and an optional comment, the thank-you
/// screen, and Edit review back to the saved values.
struct ReviewView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: ReviewViewModel

    init(service: ReviewService) {
        _model = State(initialValue: ReviewViewModel(service: service))
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                ProgressView().tint(Theme.pine).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .thanks(let review):
                thanks(review)
            default:
                form
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task { if model.state == .loading { await model.load() } }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Rate Agentic Lender")
                        .font(.largeTitle.bold())
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    if let reviewedOn = model.reviewedOn {
                        Text(reviewedOn).font(.footnote).foregroundStyle(Theme.mutedText)
                    }
                    Text("Your review helps the team improve the app.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                }
                VStack(spacing: 8) {
                    StarRating(rating: $model.form.rating)
                    Text(model.form.ratingText)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.text)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
                FormField("Comment (optional)", error: model.form.commentError) {
                    VStack(alignment: .trailing, spacing: 4) {
                        TextField("", text: $model.form.comment, axis: .vertical)
                            .lineLimit(4...8)
                            .accessibilityIdentifier("review.comment")
                        Text(model.form.commentCount)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.mutedText)
                    }
                    .padding(.vertical, 12)
                }
                if case .failed(let message) = model.state {
                    Label(message, systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundStyle(Theme.error)
                        .accessibilityIdentifier("review.failed")
                }
            }
            .padding(Theme.screenPadding)
            .disabled(model.isSaving)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            PrimaryButton(title: model.submitTitle, isLoading: model.isSaving, isEnabled: model.form.canSubmit) {
                Task { await model.submit() }
            }
            .padding(Theme.screenPadding)
            .background(Theme.oat)
            .accessibilityIdentifier("review.submit")
        }
    }

    /// Figma 22b.
    private func thanks(_ review: SavedReview) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "heart")
                .font(.title2)
                .foregroundStyle(Theme.pine)
                .frame(width: 64, height: 64)
                .background(Theme.tint, in: Circle())
                .accessibilityHidden(true)
            Text("Thanks for your review")
                .font(.title.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 8) {
                StarRating(rating: .constant(review.rating), size: .title3, isInteractive: false)
                Text(review.form.ratingText).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                if let comment = review.comment {
                    Text("\u{201C}\(comment)\u{201D}")
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
            .accessibilityElement(children: .combine)
            Spacer()
            SecondaryButton(title: "Edit review") { model.edit() }
                .accessibilityIdentifier("review.edit")
            PrimaryButton(title: "Done") { dismiss() }
                .accessibilityIdentifier("review.done")
        }
        .padding(Theme.screenPadding)
        .navigationBarBackButtonHidden()
    }
}

/// Five stars; tapping one sets the rating (Figma 22). VoiceOver adjusts it as one control. The
/// thank-you screen shows them read-only, close together as in Figma 22b, without tap targets.
struct StarRating: View {
    @Binding var rating: Int?
    var size: Font = .largeTitle
    var isInteractive = true

    var body: some View {
        HStack(spacing: isInteractive ? 12 : 4) {
            ForEach(1...5, id: \.self) { star in
                if isInteractive {
                    Button { rating = star } label: {
                        starImage(star).frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget)
                    }
                    .buttonStyle(.plain)
                } else {
                    starImage(star)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Rating")
        .accessibilityValue(rating.map { "\($0) out of 5" } ?? "No rating")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: rating = min((rating ?? 0) + 1, 5)
            case .decrement: rating = max((rating ?? 2) - 1, 1)
            @unknown default: break
            }
        }
        .accessibilityIdentifier("review.stars")
        // Read-only, "4 out of 5" beside them already says the rating.
        .accessibilityHidden(!isInteractive)
    }

    private func starImage(_ star: Int) -> some View {
        Image(systemName: star <= (rating ?? 0) ? "star.fill" : "star")
            .font(size)
            .foregroundStyle(star <= (rating ?? 0) ? Theme.pine : Theme.line)
    }
}
