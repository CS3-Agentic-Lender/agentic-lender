import SwiftUI

/// "You could borrow" (Figma frames "Affordability result" and 08a Limited by deposit).
///
/// "Start application" opens the application form. A maximum of €0 shows why the borrower
/// can't borrow and what would change it instead, with a way back to their answers (AL-237).
struct AffordabilityResultView: View {
    let outcome: AffordabilityOutcome
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var isApplying = false

    private var summary: AffordabilitySummary { outcome.summary }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(summary.cantBorrow?.title ?? "You could borrow")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)

                if let cantBorrow = summary.cantBorrow {
                    cantBorrowCard(cantBorrow)
                } else {
                    maximumLoanCard
                    figures
                    rateNote
                }
            }
            .padding(Theme.screenPadding)
        }
        .safeAreaInset(edge: .bottom) {
            Group {
                if outcome.canApply {
                    SecondaryButton(title: "Start application") { isApplying = true }
                        .accessibilityIdentifier("affordabilityResult.startApplication")
                } else {
                    PrimaryButton(title: "Change my answers") { dismiss() }
                        .accessibilityIdentifier("affordabilityResult.changeAnswers")
                }
            }
            .padding(Theme.screenPadding)
            .background(Theme.oat)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $isApplying) {
            ApplicationFormView(form: outcome.applicationForm(), onBackToHome: session.returnHome)
        }
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

    private func cantBorrowCard(_ cantBorrow: AffordabilitySummary.CantBorrow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(cantBorrow.reason)
                    .accessibilityIdentifier("affordabilityResult.cantBorrowReason")
            } icon: {
                Image(systemName: "exclamationmark.circle")
            }
            Text(cantBorrow.whatWouldChange)
                .accessibilityIdentifier("affordabilityResult.whatWouldChange")
        }
        .foregroundStyle(Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
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

#if DEBUG
#Preview {
    var form = AffordabilityForm()
    form.income = "60,000"
    form.monthlyDebts = "0"
    form.deposit = "40,000"
    let result = AffordabilityResult(
        maxLoanEur: 240_000, maxPropertyPriceEur: 280_000, monthlyRepaymentEur: 1145.80,
        stressedRepaymentEur: 1438.92, limitedBy: .income, benchmarkRatePct: 4.0,
        stressedRatePct: 6.0, rateDate: "2026-08"
    )
    return NavigationStack {
        AffordabilityResultView(outcome: AffordabilityOutcome(
            request: AffordabilityRequest(form: form)!,
            result: result,
            summary: AffordabilitySummary(result: result, termYears: 30, isFirstTimeBuyer: true),
            loanType: .mortgage
        ))
    }
    .environment(AppSession(state: PreviewSignedInState()))
}
#endif
