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
                if let breakdown = summary.breakdown {
                    BreakdownCard(breakdown: breakdown)
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

/// The breakdown (AL-136, Figma 11e): the starting point, how far each detail moved the estimate
/// (largest first), then the estimate. Hidden when the answer has no breakdown.
private struct BreakdownCard: View {
    let breakdown: ValuationBreakdown

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(ValuationBreakdown.title)
                .font(.headline)
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text(ValuationBreakdown.explanation)
                .font(.footnote)
                .foregroundStyle(Theme.mutedText)

            VStack(alignment: .leading, spacing: 2) {
                line(ValuationBreakdown.startingPointLabel, breakdown.startingPoint, color: Theme.mutedText, labelColor: Theme.mutedText)
                Text(ValuationBreakdown.startingPointNote)
                    .font(.caption)
                    .foregroundStyle(Theme.mutedText)
            }
            .accessibilityElement(children: .combine)
            Divider().overlay(Theme.line)
            ForEach(breakdown.rows, id: \.label) { row in
                line(row.label, row.amount, color: color(for: row.change))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(row.spoken)
                    .accessibilityIdentifier("valuationBreakdown.row")
            }
            Divider().overlay(Theme.line)
            line("Estimate", breakdown.estimate, color: Theme.text, bold: true)
        }
        .padding(Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
        .accessibilityIdentifier("valuationBreakdown")
    }

    /// One row: the label on the left, the amount on the right. The label wraps at large text sizes;
    /// the amount never does.
    private func line(
        _ label: String, _ amount: String, color: Color, labelColor: Color = Theme.text, bold: Bool = false
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(labelColor)
            Spacer(minLength: 12)
            Text(amount)
                .font(.system(.body, design: .monospaced).weight(bold ? .bold : .regular))
                .foregroundStyle(color)
                .fixedSize()
        }
        .font(bold ? .body.bold() : .body)
        .accessibilityElement(children: .combine)
    }

    /// Green for what added to the estimate, red for what took off. The + and − signs say the same.
    private func color(for change: ValuationBreakdown.Change) -> Color {
        switch change {
        case .up: Theme.success
        case .down: Theme.error
        case .none: Theme.text
        }
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
                askingPriceGap: 0.0986, priceNeedsReview: true, modelVersion: "v2",
                baselineEur: 310_000,
                contributions: [
                    ValuationContribution(feature: "county", eur: 22_000),
                    ValuationContribution(feature: "floor_area", eur: 15_000),
                    ValuationContribution(feature: "property_type", eur: 6_000),
                    ValuationContribution(feature: "bedrooms", eur: -5_000),
                    ValuationContribution(feature: "ber", eur: -3_000),
                    ValuationContribution(feature: "eircode_area", eur: 0),
                ]
            )
        ))
    }
}
#endif
