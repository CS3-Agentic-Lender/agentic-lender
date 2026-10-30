import Foundation
import Network

/// Whether the phone has a network connection at all. Firestore only says its answers come from the
/// cache once it has decided it's offline, which can take a while, so screens that show an "Offline"
/// banner watch this too.
@MainActor
protocol NetworkMonitor {
    /// Calls `onChange` on the main queue with whether there's a connection, now and after every change.
    func watch(onChange: @escaping (Bool) -> Void) -> LiveListener
}

/// The phone's connection, from Apple's NWPathMonitor.
struct PathNetworkMonitor: NetworkMonitor {
    nonisolated init() {}

    func watch(onChange: @escaping (Bool) -> Void) -> LiveListener {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { path in
            let connected = path.status == .satisfied
            DispatchQueue.main.async { onChange(connected) }
        }
        monitor.start(queue: DispatchQueue(label: "ie.mtu.agenticlender.network"))
        return LiveListener { monitor.cancel() }
    }
}
