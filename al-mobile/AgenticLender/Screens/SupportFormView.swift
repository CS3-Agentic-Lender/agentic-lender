import SwiftUI

/// Contact support (AL-149, Figma 20 to 21a): a category, a subject and a message, an optional
/// application reference, then the confirmation. A failed send keeps the text with Try again.
struct SupportFormView: View {
    @State private var model: SupportFormViewModel
    @State private var isCategorySheetShown = false
    @FocusState private var focused: SupportForm.Field?
    /// The broker's first name, for "message Bob instead".
    let brokerFirstName: String?

    init(service: SupportService, applicationID: String?, brokerFirstName: String?) {
        _model = State(initialValue: SupportFormViewModel(service: service, applicationID: applicationID))
        self.brokerFirstName = brokerFirstName
    }

    var body: some View {
        Group {
            if case .sent(let receipt) = model.state {
                SupportSentView(receipt: receipt, form: model.form)
            } else {
                form
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private var errors: [SupportForm.Field: String] { model.showsErrors ? model.form.errors : [:] }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Contact support")
                        .font(.largeTitle.bold())
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("For questions about your mortgage, **message \(brokerFirstName ?? "your broker")** instead.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                }
                FormField("Category", error: errors[.category]) {
                    Button { isCategorySheetShown = true } label: {
                        PickerFieldLabel(value: model.form.category?.title, placeholder: "Choose a category")
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("support.category")
                }
                FormField("Subject", error: errors[.subject]) {
                    TextField("", text: $model.form.subject)
                        .focused($focused, equals: .subject)
                        .submitLabel(.next)
                        .onSubmit { focused = .message }
                        .accessibilityIdentifier("support.subject")
                }
                messageField
                applicationToggle
                if case .failed(let message) = model.state {
                    Label(message, systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundStyle(Theme.error)
                        .accessibilityIdentifier("support.failed")
                }
            }
            .padding(Theme.screenPadding)
            .disabled(model.isSending)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            PrimaryButton(title: sendTitle, isLoading: model.isSending) {
                focused = nil
                Task { await model.send() }
            }
            .padding(Theme.screenPadding)
            .background(Theme.oat)
            .accessibilityIdentifier("support.send")
        }
        .sheet(isPresented: $isCategorySheetShown) {
            SupportCategorySheet(selection: $model.form.category)
        }
    }

    /// Figma 20c "Sending…", 21a "Try again".
    private var sendTitle: String {
        switch model.state {
        case .sending: "Sending…"
        case .failed: "Try again"
        default: "Send request"
        }
    }

    private var messageField: some View {
        FormField("Message", error: errors[.message]) {
            VStack(alignment: .trailing, spacing: 4) {
                TextField("", text: $model.form.message, axis: .vertical)
                    .lineLimit(4...8)
                    .focused($focused, equals: .message)
                    .accessibilityIdentifier("support.message")
                Text(model.form.messageCount)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.mutedText)
            }
            .padding(.vertical, 12)
        }
    }

    @ViewBuilder
    private var applicationToggle: some View {
        if let reference = model.applicationReference {
            Toggle(isOn: $model.form.includeApplication) {
                Text("Include my application reference (\(reference))")
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
            }
            .tint(Theme.pine)
            .accessibilityIdentifier("support.includeApplication")
        }
    }
}

/// Figma 20b: the four categories with their icons, the chosen one ticked.
private struct SupportCategorySheet: View {
    @Binding var selection: SupportCategory?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(SupportCategory.allCases) { category in
                Button {
                    selection = category
                    dismiss()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: category.symbol)
                            .foregroundStyle(Theme.text)
                            .frame(width: 24)
                            .accessibilityHidden(true)
                        Text(category.title)
                            .fontWeight(category == selection ? .semibold : .regular)
                            .foregroundStyle(Theme.text)
                        Spacer()
                        if category == selection {
                            Image(systemName: "checkmark").foregroundStyle(Theme.pine)
                        }
                    }
                    .frame(minHeight: Theme.minTapTarget)
                    .contentShape(Rectangle())
                }
                .listRowBackground(Theme.surface)
                .accessibilityAddTraits(category == selection ? .isSelected : [])
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .navigationTitle("Category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.pine)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
