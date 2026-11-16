import Foundation

/// Who the borrower is talking to, in words (AL-310). The thread is shared with the broker and the
/// bank's underwriters, so a reply is labelled with who sent it, and Home and the thread's header
/// stop implying every reply is from the broker once the lending officer has written. The portal
/// calls the underwriter "Bank lending officer" too.
enum ThreadParticipants {
    static let lendingOfficer = "Bank lending officer"

    /// The label above a reply: the broker's name ("Broker" if it isn't known), "Bank lending
    /// officer", or nil for a role the app doesn't know.
    static func label(for sender: MessageThread.Bubble.Sender, brokerName: String?) -> String? {
        switch sender {
        case .broker: brokerName ?? "Broker"
        case .lendingOfficer: lendingOfficer
        case .unknown: nil
        }
    }

    /// Who VoiceOver says sent a bubble, on every bubble, not only the first of a run.
    static func spokenSender(of bubble: MessageThread.Bubble, brokerName: String?) -> String? {
        if bubble.isMine { return "You" }
        return bubble.sender.flatMap { label(for: $0, brokerName: brokerName) }
    }

    /// The Messages card on Home. Nil when there's no broker name and only the broker has written.
    static func homeDetail(brokerName: String?, lendingOfficerHasWritten: Bool) -> String? {
        guard lendingOfficerHasWritten else {
            return brokerName.map { "Talk to \($0) about your application." }
        }
        return "Talk to \(brokerName ?? "your broker") and the bank's lending officer about your application."
    }

    /// The line under the broker's name at the top of the thread.
    static func headerSubtitle(brokerFirm: String?, lendingOfficerHasWritten: Bool) -> String {
        let broker = ["Your broker", brokerFirm].compactMap { $0 }.joined(separator: " · ")
        return lendingOfficerHasWritten ? "\(broker), with the bank's lending officer" : broker
    }
}
