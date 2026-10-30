/// Screens the app can push onto the navigation stack.
enum Route: Hashable {
    case signIn
    case signUp
    case affordability
    case propertyCheck
    /// The saved property checks (Figma 09).
    case properties
    case resetPassword(email: String)
}
