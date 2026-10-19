import SwiftUI

/// Choosing a broker (Figma 06 Choose broker): after sign-up with Continue, or from home's
/// "Your broker" card with Save. `onSaved` gets the profile al-core returns with the new broker.
struct BrokerPickerView: View {
    @State private var model: BrokerPickerViewModel
    private let onSaved: (CoreProfile) -> Void

    init(mode: BrokerPickerViewModel.Mode, service: ProfileService, onSaved: @escaping (CoreProfile) -> Void) {
        _model = State(initialValue: BrokerPickerViewModel(mode: mode, service: service))
        self.onSaved = onSaved
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                content
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) {
            if case .loaded = model.state { footer }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        // A borrower without a broker can't skip this step; a change can be abandoned.
        .navigationBarBackButtonHidden(model.mode == .choose || model.isSaving)
        .task { await model.load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.title)
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Text(model.existingApplicationsNote
                 ?? "Your broker reviews your application and answers your messages. You can change this later from Home.")
                .font(.body)
                .foregroundStyle(Theme.mutedText)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading brokers")
                .tint(Theme.pine)
                .foregroundStyle(Theme.mutedText)
                .frame(maxWidth: .infinity, minHeight: 160)
        case .failed(let message):
            RetryMessage(message: message) {
                Task { await model.load() }
            }
        case .loaded(let brokers):
            VStack(spacing: 12) {
                ForEach(brokers) { broker in
                    row(broker)
                }
            }
        }
    }

    private func row(_ broker: Broker) -> some View {
        let isSelected = model.selectedID == broker.uid
        return Button {
            model.select(broker)
        } label: {
            HStack(spacing: 12) {
                Text(broker.initials)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.pine)
                    .frame(width: Theme.minTapTarget, height: Theme.minTapTarget)
                    .background(Theme.tint, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(broker.name ?? "")
                        .font(.headline)
                        .foregroundStyle(Theme.text)
                    if let firm = broker.firm, !firm.trimmed.isEmpty {
                        Text(firm)
                            .font(.subheadline)
                            .foregroundStyle(Theme.mutedText)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.title2)
                    .foregroundStyle(isSelected ? Theme.pine : Theme.line)
                    .accessibilityHidden(true)
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius)
                    .stroke(isSelected ? Theme.pine : Theme.line, lineWidth: isSelected ? 2 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.isSaving)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("brokerPicker.\(broker.uid)")
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if let saveError = model.saveError {
                Label(saveError, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            PrimaryButton(
                title: model.isSaving ? "Saving..." : model.buttonTitle,
                isLoading: model.isSaving,
                isEnabled: model.canSave
            ) {
                Task {
                    if let profile = await model.save() { onSaved(profile) }
                }
            }
            .accessibilityIdentifier("brokerPicker.save")
        }
        .padding(Theme.screenPadding)
        .background(Theme.oat)
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        BrokerPickerView(mode: .choose, service: PreviewProfileService(), onSaved: { _ in })
    }
}
#endif
