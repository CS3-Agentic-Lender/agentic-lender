import SwiftUI

/// "You could borrow" (Figma frames "Affordability result" and 08a Limited by deposit).
///
/// The "Check a property" and "Start application" buttons arrive with the screens they open:
/// the property checker (Sprint 2) and the application form.
struct AffordabilityResultView: View {
    let summary: AffordabilitySummary

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("You could borrow")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                maximumLoanCard
                figures
                rateNote
            }
            .padding(Theme.screenPadding)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private var maximumLoanCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Maximum loan")
                .font(.footnote)
            Text(summary.maxLoan)
                .font(.system(.largeTitle, design: .monospaced).bold())
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .accessibilityIdentifier("affordabilityResult.maxLoan")
            Text(summary.limit)
                .font(.footnote)
                .accessibilityIdentifier("affordabilityResult.limit")
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
            FigureRow(label: "Maximum property price", value: summary.maxPropertyPrice, id: "maxPropertyPrice")
            Divider().overlay(Theme.line)
            FigureRow(label: "Monthly repayment", value: summary.monthlyRepayment, id: "monthlyRepayment")
            Divider().overlay(Theme.line)
            FigureRow(label: "If rates rise 2%", value: summary.stressedRepayment, id: "stressedRepayment")
        }
        .padding(.horizontal, Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
    }

    private var rateNote: some View {
        Label {
            Text(summary.rateNote)
        } icon: {
            Image(systemName: "info.circle")
        }
        .font(.footnote)
        .foregroundStyle(Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .accessibilityIdentifier("affordabilityResult.rateNote")
    }
}

/// One label and amount in the figures card.
private struct FigureRow: View {
    let label: String
    let value: String
    let id: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .font(.system(.body, design: .monospaced).weight(.semibold))
                .accessibilityIdentifier("affordabilityResult.\(id)")
        }
        .foregroundStyle(Theme.text)
        .frame(minHeight: Theme.minTapTarget)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack {
        AffordabilityResultView(summary: AffordabilitySummary(
            result: AffordabilityResult(
                maxLoanEur: 240_000, maxPropertyPriceEur: 280_000, monthlyRepaymentEur: 1145.80,
                stressedRepaymentEur: 1438.92, limitedBy: .income, benchmarkRatePct: 4.0,
                stressedRatePct: 6.0, rateDate: "2026-08"
            ),
            termYears: 30, isFirstTimeBuyer: true
        ))
    }
}
