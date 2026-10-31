import Foundation

/// The thread as the screen lays it out (AL-147, Figma 15, 15c and 15e): messages oldest first, a
/// day label before each day, one time under each run of messages sent close together, a
/// "New messages" divider above the first reply the borrower hasn't read, and the borrower's
/// messages still sending or not sent at the end.
struct MessageThread: Equatable {
    struct Bubble: Equatable {
        enum Delivery: Equatable {
            case sent
            case sending
            case notSent
        }

        let id: String
        let text: String
        let isMine: Bool
        /// "09:41", under the last message of a run. Nil inside a run, and while it's still sending.
        let time: String?
        var delivery: Delivery = .sent
    }

    enum Row: Equatable {
        case day(String)
        case newMessages
        case bubble(Bubble)
    }

    /// Messages from one sender this close together share one time, as in Figma 15e.
    static let runGap: TimeInterval = 5 * 60

    let rows: [Row]
    /// Replies sent to the borrower that they haven't read.
    let unreadCount: Int

    var isEmpty: Bool { rows.isEmpty }

    /// Each row with an id that stays the same as messages arrive, so the list keeps its place: a
    /// bubble's message id, and for a day label or the divider, the id of the message after it.
    var identifiedRows: [(id: String, row: Row)] {
        var nextMessageID = ""
        let backwards = rows.reversed().map { row -> (id: String, row: Row) in
            switch row {
            case .bubble(let bubble):
                nextMessageID = bubble.id
                return (bubble.id, row)
            case .day:
                return ("day-\(nextMessageID)", row)
            case .newMessages:
                return ("new-\(nextMessageID)", row)
            }
        }
        return backwards.reversed()
    }

    init(messages: [Message], pending: [PendingMessage] = [], myID: String, now: Date = .now, timeZone: TimeZone = .current) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let ordered = messages.sorted { ($0.sentAt, $0.id) < ($1.sentAt, $1.id) }
        let isUnreadReply = { (message: Message) in message.senderID != myID && !message.read }
        let firstUnread = ordered.first(where: isUnreadReply)?.id
        let labels = Labels(calendar: calendar, now: now)

        let messageRows: [Row] = ordered.indices.flatMap { index -> [Row] in
            let message = ordered[index]
            let previous = index > 0 ? ordered[index - 1] : nil
            let next = index + 1 < ordered.count ? ordered[index + 1] : nil
            var rows: [Row] = []
            if previous.map({ !calendar.isDate($0.sentAt, inSameDayAs: message.sentAt) }) ?? true {
                rows.append(.day(labels.day(message.sentAt)))
            }
            if message.id == firstUnread {
                rows.append(.newMessages)
            }
            let endsRun = next.map { !Self.sameRun(message, $0, calendar: calendar) } ?? true
            rows.append(.bubble(Bubble(
                id: message.id, text: message.text, isMine: message.senderID == myID,
                time: endsRun ? labels.time(message.sentAt) : nil
            )))
            return rows
        }
        rows = messageRows + Self.pendingRows(pending, after: ordered.last?.sentAt, calendar: calendar, labels: labels)
        unreadCount = ordered.filter(isUnreadReply).count
    }

    /// The borrower's own messages that aren't in Firestore yet, after the thread, with a day label
    /// when the day changes and no time until they're sent.
    private static func pendingRows(_ pending: [PendingMessage], after lastSent: Date?, calendar: Calendar, labels: Labels) -> [Row] {
        var previous = lastSent
        return pending.flatMap { message -> [Row] in
            var rows: [Row] = []
            if previous.map({ !calendar.isDate($0, inSameDayAs: message.sentAt) }) ?? true {
                rows.append(.day(labels.day(message.sentAt)))
            }
            previous = message.sentAt
            let delivery: Bubble.Delivery = message.state == .notSent ? .notSent : .sending
            rows.append(.bubble(Bubble(id: message.id, text: message.text, isMine: true, time: nil, delivery: delivery)))
            return rows
        }
    }

    private static func sameRun(_ first: Message, _ second: Message, calendar: Calendar) -> Bool {
        first.senderID == second.senderID
            && second.sentAt.timeIntervalSince(first.sentAt) <= runGap
            && calendar.isDate(first.sentAt, inSameDayAs: second.sentAt)
    }

    /// "Today", "Yesterday" or "21 Oct", and "09:41", in the borrower's time zone.
    private struct Labels {
        let calendar: Calendar
        let now: Date
        let dayFormatter: DateFormatter
        let timeFormatter: DateFormatter

        init(calendar: Calendar, now: Date) {
            self.calendar = calendar
            self.now = now
            // POSIX so the labels don't change with the phone's language settings.
            dayFormatter = Self.formatter("d MMM", calendar: calendar)
            timeFormatter = Self.formatter("HH:mm", calendar: calendar)
        }

        func day(_ date: Date) -> String {
            if calendar.isDate(date, inSameDayAs: now) { return "Today" }
            if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
                return "Yesterday"
            }
            return dayFormatter.string(from: date)
        }

        func time(_ date: Date) -> String {
            timeFormatter.string(from: date)
        }

        private static func formatter(_ format: String, calendar: Calendar) -> DateFormatter {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = format
            return formatter
        }
    }
}
