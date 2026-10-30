import SwiftUI

/// The borrower's thread with their broker (AL-147, Figma 15 to 15c and 15e). It shows the messages
/// live from Firestore; a new message shows straight away while al-core saves it, and one that
/// fails is marked "Not sent" to tap and try again. Leaving the thread marks the replies read.
struct MessagesView: View {
    let inbox: MessageInbox
    let brokerName: String?
    let brokerFirm: String?
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.line)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if case .ready = inbox.state {
                Divider().overlay(Theme.line)
                composer
            }
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task { await inbox.start() }
        // The "New messages" divider shows while they read, then the badge and divider clear.
        .onDisappear { Task { await inbox.markThreadRead() } }
    }

    /// Figma 15 and 15b: the field grows to a few lines, and Send is Pine once there's something to send.
    private var composer: some View {
        let canSend = MessageInbox.canSend(draft)
        return HStack(alignment: .bottom, spacing: 8) {
            TextField("Message \(Self.firstName(of: brokerName) ?? "your broker")", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .font(.body)
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: Theme.minTapTarget)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.line))
                .accessibilityIdentifier("messages.field")
            Button {
                let text = draft
                draft = ""
                Task { await inbox.send(text) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(canSend ? Theme.surface : Theme.mutedText)
                    .frame(width: Theme.minTapTarget, height: Theme.minTapTarget)
                    .background(canSend ? Theme.pine : Theme.tint, in: Circle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
            .accessibilityIdentifier("messages.send")
        }
        .padding(.horizontal, Theme.screenPadding)
        .padding(.vertical, 8)
        .background(Theme.surface)
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
                ThreadList(thread: thread) { id in Task { await inbox.retry(id) } }
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
    /// Sends a "Not sent" message again.
    let retry: (String) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(thread.identifiedRows, id: \.id) { item in
                        rowView(item.row)
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
            BubbleView(bubble: bubble) { retry(bubble.id) }
        }
    }
}

/// The broker's messages on the left in Surface, the borrower's on the right in Pine (Figma 15). One
/// still sending or not sent is a lighter Pine, and a "Not sent" one says so in red (Figma 15c).
private struct BubbleView: View {
    let bubble: MessageThread.Bubble
    let retry: () -> Void

    /// Pine at this opacity on Oat is the muted bubble in Figma 15c.
    private static let pendingOpacity = 0.6

    var body: some View {
        VStack(alignment: bubble.isMine ? .trailing : .leading, spacing: 4) {
            Text(bubble.text)
                .font(.body)
                .foregroundStyle(bubble.isMine ? Theme.surface : Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(bubble.isMine ? Theme.pine.opacity(bubble.delivery == .sent ? 1 : Self.pendingOpacity) : Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay {
                    if !bubble.isMine {
                        RoundedRectangle(cornerRadius: 16).stroke(Theme.line)
                    }
                }
                .textSelection(.enabled)
            switch bubble.delivery {
            case .sent:
                if let time = bubble.time {
                    Text(time)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.mutedText)
                }
            case .sending:
                Text("Sending")
                    .font(.caption2)
                    .foregroundStyle(Theme.mutedText)
            case .notSent:
                Button(action: retry) {
                    Label("Not sent. Tap to try again", systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundStyle(Theme.error)
                        .frame(minHeight: Theme.minTapTarget)
                }
                .accessibilityIdentifier("messages.notSent")
            }
        }
        .frame(maxWidth: .infinity, alignment: bubble.isMine ? .trailing : .leading)
        .padding(bubble.isMine ? .leading : .trailing, 56)
        .accessibilityElement(children: bubble.delivery == .notSent ? .contain : .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        let status: String? = switch bubble.delivery {
        case .sent: bubble.time
        case .sending: "sending"
        case .notSent: "not sent"
        }
        return [bubble.isMine ? "You" : "Your broker", bubble.text, status].compactMap { $0 }.joined(separator: ", ")
    }
}
