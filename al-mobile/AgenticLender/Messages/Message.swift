import Foundation

/// One message in `applications/{id}/messages` (al-core SCHEMA.md). Clients only read these;
/// al-core writes them.
struct Message: Equatable, Identifiable, Sendable {
    enum Role: String, Sendable {
        case borrower
        case broker
        case underwriter
        /// A role the app doesn't know yet; the message still shows.
        case other
    }

    let id: String
    let senderID: String
    let senderRole: Role
    let text: String
    let sentAt: Date
    /// Whether the person it was sent to has read it.
    let read: Bool

    init(id: String, senderID: String, senderRole: Role, text: String, sentAt: Date, read: Bool) {
        self.id = id
        self.senderID = senderID
        self.senderRole = senderRole
        self.text = text
        self.sentAt = sentAt
        self.read = read
    }

    /// From Firestore fields with timestamps already converted to `Date`. Nil without a sender, text
    /// or time, since such a message can't be placed in the thread.
    init?(id: String, fields: [String: Any]) {
        guard let senderID = fields["senderId"] as? String,
              let text = fields["text"] as? String,
              let sentAt = fields["sentAt"] as? Date
        else { return nil }
        self.init(
            id: id,
            senderID: senderID,
            senderRole: (fields["senderRole"] as? String).flatMap(Role.init(rawValue:)) ?? .other,
            text: text,
            sentAt: sentAt,
            read: fields["read"] as? Bool ?? false
        )
    }
}
