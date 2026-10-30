/// Stops a live Firestore listener: Firestore's own registration in the app, a closure in tests.
///
/// It also stops when it's let go of, so a listener never outlives the screen that holds it, and
/// stopping twice does nothing.
final class LiveListener {
    private var stopListening: (() -> Void)?

    init(_ stop: @escaping () -> Void) {
        stopListening = stop
    }

    func stop() {
        stopListening?()
        stopListening = nil
    }

    deinit {
        stop()
    }
}
