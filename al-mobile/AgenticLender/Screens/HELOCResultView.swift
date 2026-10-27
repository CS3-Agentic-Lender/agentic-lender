import SwiftUI

/// "You could borrow" for a HELOC (Figma 07k HELOC result): the most the homeowner can draw,
/// what limited it, and the repayments with the line fully drawn. A line of €0 says there is
/// no equity instead. Start application joins with the HELOC application (AL-208).
struct HELOCResultView: View {
    let summary: HELOCSummary

    init(result: HELOCResult, termYears: Int) {
        summary = HELOCSummary(result: result, termYears: termYears)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("You could borrow")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                maximumLineCard
                if let noEquity = summary.noEquity {
                    note(noEquity, systemImage: "exclamationmark.circle", id: "noEquity")
                }
                figures
                note(summary.rateNote, systemImage: "info.circle", id: "rateNote")
            }
            .padding(Theme.screenPadding)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private var maximumLineCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Maximum credit line")
                .font(.footnote)
            Text(summary.maxLine)
                .font(.system(.largeTitle, design: .monospaced).bold())
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .accessibilityIdentifier("helocResult.maxLine")
            Text(summary.limit)
                .font(.footnote)
                .accessibilityIdentifier("helocResult.limit")
        }
        .foregroundStyle(Theme.surface)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.screenPadding)
        .background(Theme.pine)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .accessibilityElement(children: .combine)
    }

    private var figures: some View {
        VStack(spacing: 0) {
            row("Estimated value of your home", summary.estimatedValue, id: "estimatedValue")
            Divider().overlay(Theme.line)
            row("Monthly repayment, fully drawn", summary.monthlyRepayment, id: "monthlyRepayment")
            Divider().overlay(Theme.line)
            row("If rates rise 2%", summary.stressedRepayment, id: "stressedRepayment")
        }
        .padding(.horizontal, Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
    }

    private func row(_ label: String, _ value: String, id: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .font(.system(.body, design: .monospaced).weight(.semibold))
                .accessibilityIdentifier("helocResult.\(id)")
        }
        .foregroundStyle(Theme.text)
        .frame(minHeight: Theme.minTapTarget)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func note(_ text: String, systemImage: String, id: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: systemImage)
        }
        .font(.footnote)
        .foregroundStyle(Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .accessibilityIdentifier("helocResult.\(id)")
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        HELOCResultView(
            result: HELOCResult(
                homeValueEur: 262_353.72, maxLineEur: 59_882.97, combinedLtv: 0.8, monthlyRepaymentEur: 362.88,
                stressedRepaymentEur: 429.02, limitedBy: .equity, benchmarkRatePct: 4.0, stressedRatePct: 6.0, rateDate: "2026-08"
            ),
            termYears: 20
        )
    }
}
#endif
