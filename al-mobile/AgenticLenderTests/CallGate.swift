/// Holds a fake's calls open so a test can act while a call is still running. The test awaits
/// `waitForCall()` instead of polling with `Task.yield()`, and an `open()` that comes before the
/// call still lets it through, so a fake never waits forever (AL-276).
@MainActor
final class CallGate {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var callArrived: CheckedContinuation<Void, Never>?
    private var isOpen = false

    func pass() async {
        guard !isOpen else { return }
        await withCheckedContinuation { continuation in
            waiting.append(continuation)
            callArrived?.resume()
            callArrived = nil
        }
    }

    /// Returns once a call is waiting at the gate.
    func waitForCall() async {
        guard waiting.isEmpty else { return }
        await withCheckedContinuation { callArrived = $0 }
    }

    /// Lets every waiting call through, and any later one.
    func open() {
        isOpen = true
        let released = waiting
        waiting = []
        released.forEach { $0.resume() }
    }
}
