import SwiftUI

/// "My application" (AL-102, Figma 14, 14a and 14b): the application's reference and its status
/// timeline, live (AL-103): a change shows by itself, and offline the last known status stays with a
/// banner (Figma 14d).
struct ApplicationStatusView: View {
    @State private var model: ApplicationStatusViewModel
    @State private var isExplaining = false

    init(applicationID: String, service: ApplicationStatusService, network: NetworkMonitor = PathNetworkMonitor()) {
        _model = State(initialValue: ApplicationStatusViewModel(applicationID: applicationID, service: service, network: network))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if model.isOffline && model.timeline != nil {
                    OfflineBanner(text: ApplicationStatusViewModel.offlineBanner)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("My application")
                        .font(.largeTitle.bold())
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(model.reference)
                        .font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(Theme.mutedText)
                        .accessibilityIdentifier("status.reference")
                }
                content
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.start() }
        .animation(.default, value: model.isOffline)
    }

    @ViewBuilder
    private var content: some View {
        if let timeline = model.timeline {
            if let figures = model.figures {
                FigureTiles(figures: figures)
                Button("What do these mean?") { isExplaining = true }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .frame(minHeight: Theme.minTapTarget)
                    .accessibilityIdentifier("status.whatTheyMean")
                    .sheet(isPresented: $isExplaining) { FigureExplanations(figures: figures) }
            }
            TimelineCard(timeline: timeline)
        } else if let error = model.loadError {
            RetryMessage(message: error) { model.retry() }
        } else {
            ProgressView("Loading your application")
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
        }
    }
}

/// Figma 14: LTV, DTI and approval likelihood in three tiles (AL-145). The figures are the backend's;
/// before the AI review they show "—" and likelihood Unknown.
private struct FigureTiles: View {
    let figures: LoanFigures

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            tile(figures.ltv.title, figures.ltv.value, note: figures.ltv.note)
            tile(figures.dti.title, figures.dti.value, note: figures.dti.note)
            VStack(alignment: .leading, spacing: 6) {
                Text("Approval likelihood")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                StatusBadge(text: figures.likelihood.label, tone: figures.likelihood.tone)
                Text(LoanFigures.likelihoodNote)
                    .font(.caption)
                    .foregroundStyle(Theme.mutedText)
            }
            .tileStyle()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Approval likelihood \(figures.likelihood.label), indicative")
        }
        .accessibilityIdentifier("status.figures")
    }

    private func tile(_ title: String, _ value: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
            Text(value)
                .font(.system(.title2, design: .monospaced).bold())
                .foregroundStyle(Theme.text)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(note)
                .font(.caption)
                .foregroundStyle(Theme.mutedText)
        }
        .tileStyle()
        .accessibilityElement(children: .combine)
    }
}

private extension View {
    func tileStyle() -> some View {
        frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.4))
            .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.4).stroke(Theme.line))
    }
}

/// Figma 14e "What do these mean?": one plain explanation per figure.
private struct FigureExplanations: View {
    let figures: LoanFigures
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(figures.explanations, id: \.title) { explanation in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(explanation.title).font(.headline)
                                Spacer()
                                if let value = explanation.value {
                                    Text(value).font(.system(.body, design: .monospaced))
                                }
                            }
                            .foregroundStyle(Theme.text)
                            Text(explanation.text)
                                .font(.subheadline)
                                .foregroundStyle(Theme.mutedText)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Theme.screenPadding)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.4))
                        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.4).stroke(Theme.line))
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(Theme.screenPadding)
            }
            .background(Theme.oat.ignoresSafeArea())
            .navigationTitle("What do these mean?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Figma 14d: the last known status is shown below, so this only says why it may be out of date.
private struct OfflineBanner: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "wifi.slash")
            .font(.footnote)
            .foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.neutral, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .accessibilityIdentifier("status.offline")
    }
}

/// The card of steps, one row each, joined by a line down the left.
private struct TimelineCard: View {
    let timeline: StatusTimeline

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(timeline.steps.enumerated()), id: \.element.title) { index, step in
                StepRow(
                    step: step,
                    lineBelow: index < timeline.steps.count - 1 ? lineColor(below: step) : nil
                )
            }
        }
        .padding(Theme.screenPadding)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
        .accessibilityIdentifier("status.timeline")
    }

    /// Dark from a finished step down to the next one, light below the current or later steps.
    private func lineColor(below step: StatusTimeline.Step) -> Color {
        step.mark == .done ? Theme.pine : Theme.line
    }
}

private struct StepRow: View {
    let step: StatusTimeline.Step
    let lineBelow: Color?

    private static let markerSize: CGFloat = 22

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                marker
                if let lineBelow {
                    Rectangle()
                        .fill(lineBelow)
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: Self.markerSize)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(step.title)
                        .font(isHighlighted ? .body.weight(.semibold) : .body)
                        .foregroundStyle(step.mark == .upcoming ? Theme.mutedText : Theme.text)
                    Spacer(minLength: 8)
                    if let badge = step.badge {
                        StatusBadge(text: badge.text, tone: badge.tone)
                    } else if let date = step.date {
                        Text(date)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(Theme.mutedText)
                    }
                }
                if let detail = step.detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(Theme.mutedText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.bottom, lineBelow == nil ? 0 : 18)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityIdentifier("status.step")
    }

    private var isHighlighted: Bool {
        step.mark == .current || step.mark == .declined
    }

    @ViewBuilder
    private var marker: some View {
        let size = Self.markerSize
        switch step.mark {
        case .done:
            Image(systemName: "checkmark")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.surface)
                .frame(width: size, height: size)
                .background(Theme.pine, in: Circle())
        case .declined:
            Image(systemName: "xmark")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.surface)
                .frame(width: size, height: size)
                .background(Theme.error, in: Circle())
        case .current:
            Circle()
                .stroke(Theme.pine, lineWidth: 2)
                .frame(width: size, height: size)
                .overlay(Circle().fill(Theme.pine).frame(width: 8, height: 8))
        case .upcoming:
            Circle()
                .stroke(Theme.line, lineWidth: 2)
                .frame(width: size, height: size)
        }
    }

    /// e.g. "Applied, current step, Submitted 22 Sep · the AI credit committee is reviewing it".
    private var spoken: String {
        let state: String = switch step.mark {
        case .done: "done"
        case .current: "current step"
        case .upcoming: "not reached yet"
        case .declined: "declined"
        }
        return [step.title, state, step.badge.map(\.text).flatMap { $0 == "Now" ? nil : $0 }, step.date, step.detail]
            .compactMap { $0 }
            .joined(separator: ", ")
    }
}

#if DEBUG
private struct PreviewStatusService: ApplicationStatusService {
    let record: ApplicationStatusRecord
    var isFromCache = false

    func listen(to applicationID: String, onChange: @escaping (Result<StatusUpdate, ApplicationStatusError>) -> Void) -> LiveListener {
        onChange(.success(StatusUpdate(record: record, isFromCache: isFromCache)))
        return LiveListener {}
    }
}

#Preview("Applied") {
    NavigationStack {
        ApplicationStatusView(applicationID: "7f3k9qx2abc", service: PreviewStatusService(record: ApplicationStatusRecord(
            status: .applied, createdAt: .now.addingTimeInterval(-86_400), submittedAt: .now, decision: nil, history: []
        )))
    }
}

#Preview("Offline") {
    NavigationStack {
        ApplicationStatusView(applicationID: "7f3k9qx2abc", service: PreviewStatusService(record: ApplicationStatusRecord(
            status: .aiDeliberated, createdAt: .now.addingTimeInterval(-3 * 86_400), submittedAt: .now.addingTimeInterval(-2 * 86_400),
            decision: nil, history: []
        ), isFromCache: true))
    }
}

#Preview("Declined") {
    NavigationStack {
        ApplicationStatusView(applicationID: "7f3k9qx2abc", service: PreviewStatusService(record: ApplicationStatusRecord(
            status: .declined, createdAt: .now.addingTimeInterval(-8 * 86_400), submittedAt: .now.addingTimeInterval(-7 * 86_400),
            decision: .init(outcome: .declined, decidedAt: .now, reason: "your repayments would take 44% of your income, above the 40% limit"),
            history: []
        )))
    }
}
#endif
