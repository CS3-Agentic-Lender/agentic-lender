import SwiftUI

/// The property check result (Figma 11 Over-priced, 11a Fair, 11b Low-support warning, 11c No asking
/// price): the estimate to the nearest €1,000, Fair or Over-priced against the asking price, and any
/// warnings, and Save this property (11d). Starting an application from it comes in later work.
struct ValuationResultView: View {
    let summary: ValuationSummary
    /// Nil where there's nothing to save to, such as a preview.
    @State private var save: SaveCheckModel?
    @Environment(\.dismiss) private var dismiss

    init(summary: ValuationSummary, draft: SavedCheckDraft? = nil, savedChecks: SavedCheckService? = nil) {
        self.summary = summary
        if let draft, let savedChecks {
            _save = State(initialValue: SaveCheckModel(draft: draft, service: savedChecks))
        } else {
            _save = State(initialValue: nil)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if save?.state == .saved {
                    savedBanner
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(summary.title)
                        .font(.largeTitle.bold())
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(summary.details)
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                        .accessibilityIdentifier("valuationResult.details")
                }

                estimateCard
                ForEach(summary.warnings, id: \.self) { warning in
                    warningNote(warning)
                }
            }
            .padding(Theme.screenPadding)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if let save { saveFooter(save) }
        }
    }

    /// Figma 11d: "Saved to your properties". The list is one step back, on Properties.
    private var savedBanner: some View {
        Label("Saved to your properties", systemImage: "checkmark")
            .font(.subheadline)
            .foregroundStyle(Theme.success)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.success.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .accessibilityIdentifier("valuationResult.saved")
    }

    private func saveFooter(_ save: SaveCheckModel) -> some View {
        VStack(spacing: 8) {
            if case .failed(let message) = save.state {
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("valuationResult.saveError")
            }
            PrimaryButton(
                title: save.state == .saved ? "Saved" : "Save this property",
                isLoading: save.state == .saving,
                isEnabled: save.canSave
            ) {
                Task { await save.save() }
            }
            .accessibilityIdentifier("valuationResult.save")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }

    private var estimateCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Estimate")
                        .font(.footnote)
                        .foregroundStyle(Theme.mutedText)
                    Spacer()
                    if let verdict = summary.verdict {
                        VerdictBadge(verdict: verdict)
                    }
                }
                Text(summary.estimate)
                    .font(.system(.largeTitle, design: .monospaced).bold())
                    .foregroundStyle(Theme.text)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .accessibilityIdentifier("valuationResult.estimate")
                Text(summary.basis)
                    .font(.caption)
                    .foregroundStyle(Theme.mutedText)
                    .accessibilityIdentifier("valuationResult.basis")
            }
            .accessibilityElement(children: .combine)

            Divider().overlay(Theme.line)
            askingPriceSection
        }
        .padding(Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
    }

    @ViewBuilder
    private var askingPriceSection: some View {
        if let askingPrice = summary.askingPrice, let comparison = summary.comparison {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Asking price")
                    Spacer()
                    Text(askingPrice)
                        .font(.system(.body, design: .monospaced).weight(.semibold))
                        .foregroundStyle(summary.verdict == .overPriced ? Theme.error : Theme.text)
                }
                .foregroundStyle(Theme.text)
                .accessibilityElement(children: .combine)
                Text(comparison)
                    .font(.footnote)
                    .foregroundStyle(Theme.mutedText)
                    .accessibilityIdentifier("valuationResult.comparison")
            }
        } else {
            // Figma 11c: back to the form, where the asking price can be added.
            Button("Add an asking price") { dismiss() }
                .font(.headline)
                .foregroundStyle(Theme.pine)
                .frame(minHeight: Theme.minTapTarget)
                .accessibilityIdentifier("valuationResult.addAskingPrice")
        }
    }

    private func warningNote(_ text: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: "exclamationmark.triangle")
        }
        .font(.footnote)
        .foregroundStyle(Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.neutral)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .accessibilityIdentifier("valuationResult.warning")
    }
}

/// Fair (green, tick) or Over-priced (red, up arrow), as on Figma 11 and 11a, and on a saved check's row (09).
struct VerdictBadge: View {
    let verdict: ValuationSummary.Verdict

    var body: some View {
        Label(verdict.label, systemImage: verdict == .fair ? "checkmark" : "arrow.up")
            .font(.caption.weight(.semibold))
            .foregroundStyle(verdict == .fair ? Theme.success : Theme.error)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background((verdict == .fair ? Theme.success : Theme.error).opacity(0.12))
            .clipShape(Capsule())
            .accessibilityLabel("Price check: \(verdict.label)")
            .accessibilityIdentifier("valuationResult.verdict")
    }
}

#if DEBUG
#Preview("Over-priced") {
    NavigationStack {
        ValuationResultView(summary: ValuationSummary(
            request: ValuationRequest(form: PropertyCheckForm(
                county: .cork, eircode: "T12 X8Y2", floorArea: "110", bedrooms: 3,
                propertyType: .semiDetached, berRating: .b3, askingPrice: "379,000"
            ))!,
            result: ValuationResult(
                estimateEur: 345_000, displayEstimateEur: 345_000, basis: "2024 asking-price estimate",
                supportWarnings: ["BER A0 is not a grade the model was trained on, so it is valued as an unknown rating."],
                askingPriceGap: 0.0986, priceNeedsReview: true, modelVersion: "v2"
            )
        ))
    }
}
#endif
