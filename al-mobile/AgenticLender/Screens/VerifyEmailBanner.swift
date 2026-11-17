import SwiftUI

/// Home's "Check your inbox" banner (AL-311): under the greeting until a password account's email is
/// verified, with Resend email. After a resend the button reads "Sent. Check your inbox." for 60 seconds.
struct VerifyEmailBanner: View {
    let model: EmailVerificationModel
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "envelope.badge")
                .font(.title3)
                .foregroundStyle(Theme.pine)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
                resendButton
                if let error = model.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.error)
                        .accessibilityIdentifier("home.verifyEmail.error")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.tint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.verifyEmail")
        // Starts again if Home comes back mid-cooldown, so the button never stays disabled for good.
        .task(id: model.isCoolingDown) { await model.waitOutCooldown() }
    }

    /// Resend email, or during the cooldown plain "Sent" text: a disabled button would be dimmed below
    /// a readable contrast on the tint.
    @ViewBuilder
    private var resendButton: some View {
        if model.canResend {
            Button {
                Task { await model.resend() }
            } label: {
                resendLabel(systemImage: "arrow.clockwise", colour: Theme.pine)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("home.verifyEmail.resend")
        } else {
            resendLabel(systemImage: "checkmark", colour: Theme.mutedText)
                .accessibilityIdentifier("home.verifyEmail.sent")
        }
    }

    private func resendLabel(systemImage: String, colour: Color) -> some View {
        Label(model.resendTitle, systemImage: systemImage)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(colour)
            .frame(minHeight: Theme.minTapTarget)
    }
}
