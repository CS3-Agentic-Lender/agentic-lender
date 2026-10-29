import SwiftUI

/// The borrower's thread with their broker (AL-147, Figma 15, 15a and 15e). It shows the messages live
/// from Firestore. Writing a message waits for al-core's send endpoint.
struct MessagesView: View {
    let inbox: MessageInbox
    let brokerName: String?
    let brokerFirm: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.line)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task { await inbox.start() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text(Self.initials(of: brokerName))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.pine)
                .frame(width: 40, height: 40)
                .background(Theme.tint, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(brokerName ?? "Your broker")
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Text(["Your broker", brokerFirm].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedText)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.screenPadding)
        .background(Theme.surface)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var content: some View {
        switch inbox.state {
        case .loading:
            ProgressView("Loading your messages")
        case .noApplication:
            note(
                title: "No application yet",
                text: "You can message your broker once you've submitted your application."
            )
        case .failed(let message):
            RetryMessage(message: message) { Task { await inbox.start() } }
        case .ready:
            if let thread = inbox.thread, !thread.isEmpty {
                ThreadList(thread: thread)
            } else {
                // Figma 15a.
                note(
                    title: "No messages yet",
                    text: "Ask \(Self.firstName(of: brokerName) ?? "your broker") anything about your mortgage. Brokers usually reply within one working day."
                )
            }
        }
    }

    private func note(title: String, text: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left")
                .font(.title)
                .foregroundStyle(Theme.mutedText)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.bold())
                .foregroundStyle(Theme.text)
            Text(text)
                .font(.body)
                .foregroundStyle(Theme.mutedText)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("messages.note")
    }

    /// "BB" for Bob Byrne.
    static func initials(of name: String?) -> String {
        let letters = (name ?? "").split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    private static func firstName(of name: String?) -> String? {
        name.flatMap { HomeViewModel.firstName(from: $0) }
    }
}

/// The messages, oldest at the top, kept scrolled to the newest.
private struct ThreadList: View {
    let thread: MessageThread

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(thread.rows.enumerated()), id: \.offset) { _, row in
                        rowView(row)
                    }
                    Color.clear.frame(height: 1).id(Self.bottom)
                }
                .padding(Theme.screenPadding)
            }
            .onAppear { proxy.scrollTo(Self.bottom, anchor: .bottom) }
            .onChange(of: thread) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
        }
        .accessibilityIdentifier("messages.thread")
    }

    private static let bottom = "bottom"

    @ViewBuilder
    private func rowView(_ row: MessageThread.Row) -> some View {
        switch row {
        case .day(let label):
            Text(label)
                .font(.footnote)
                .foregroundStyle(Theme.mutedText)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        case .newMessages:
            HStack(spacing: 12) {
                Rectangle().fill(Theme.pine).frame(height: 1)
                Text("New messages")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.pine)
                    .fixedSize()
                Rectangle().fill(Theme.pine).frame(height: 1)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        case .bubble(let bubble):
            BubbleView(bubble: bubble)
        }
    }
}

/// The broker's messages on the left in Surface, the borrower's on the right in Pine (Figma 15).
private struct BubbleView: View {
    let bubble: MessageThread.Bubble

    var body: some View {
        VStack(alignment: bubble.isMine ? .trailing : .leading, spacing: 4) {
            Text(bubble.text)
                .font(.body)
                .foregroundStyle(bubble.isMine ? Theme.surface : Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(bubble.isMine ? Theme.pine : Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay {
                    if !bubble.isMine {
                        RoundedRectangle(cornerRadius: 16).stroke(Theme.line)
                    }
                }
                .textSelection(.enabled)
            if let time = bubble.time {
                Text(time)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.mutedText)
            }
        }
        .frame(maxWidth: .infinity, alignment: bubble.isMine ? .trailing : .leading)
        .padding(bubble.isMine ? .leading : .trailing, 56)
        .accessibilityElement(children: .combine)
        .accessibilityLabel([bubble.isMine ? "You" : "Your broker", bubble.text, bubble.time].compactMap { $0 }.joined(separator: ", "))
    }
}
