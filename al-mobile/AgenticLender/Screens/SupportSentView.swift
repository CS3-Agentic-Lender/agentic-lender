import SwiftUI

/// Figma 21 "Request sent": the reference, the two-working-day promise, what was sent and when, and Done.
struct SupportSentView: View {
    @Environment(\.dismiss) private var dismiss
    let receipt: SupportReceipt
    let form: SupportForm

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(Theme.pine)
                    .accessibilityHidden(true)
                Text("Request sent")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Text(SupportFormViewModel.confirmation(for: receipt))
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .accessibilityIdentifier("support.confirmation")
                details
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) {
            PrimaryButton(title: "Done") { dismiss() }
                .padding(Theme.screenPadding)
                .background(Theme.oat)
                .accessibilityIdentifier("support.done")
        }
        .navigationBarBackButtonHidden()
    }

    private var details: some View {
        VStack(spacing: 0) {
            row("Category", form.category?.title ?? "")
            Divider().overlay(Theme.line)
            row("Subject", form.subject.trimmingCharacters(in: .whitespacesAndNewlines))
            Divider().overlay(Theme.line)
            row("Sent", receipt.sentAt.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).foregroundStyle(Theme.mutedText)
            Spacer(minLength: 8)
            Text(value).foregroundStyle(Theme.text).multilineTextAlignment(.trailing)
        }
        .font(.body)
        .padding(.horizontal, 16)
        .frame(minHeight: Theme.minTapTarget + 8)
        .accessibilityElement(children: .combine)
    }
}
