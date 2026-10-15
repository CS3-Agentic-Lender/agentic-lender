import SwiftUI

/// A message in place of content that couldn't load, with Retry underneath.
struct RetryMessage: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.circle")
                .font(.title)
                .foregroundStyle(Theme.mutedText)
                .accessibilityHidden(true)
            Text(message)
                .font(.body)
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            SecondaryButton(title: "Retry", action: retry)
                .accessibilityIdentifier("retry")
        }
        .padding(Theme.screenPadding)
        .frame(maxWidth: .infinity)
    }
}
