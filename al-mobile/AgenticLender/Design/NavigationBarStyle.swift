import SwiftUI
import UIKit

/// The navigation bar behind the clock and the floating back button (AL-296).
///
/// The screens draw their own large title in a scroll view on Oat. On iOS 26 a bar with no background
/// only fades scrolled content slightly, so titles and figures ran under the clock and the back button.
/// The bar is Oat instead: at the top of a screen it matches the screen, so nothing looks different,
/// and once scrolled, content passes under it with a hairline in Line to mark the edge.
enum NavigationBarStyle {
    static func apply() {
        let bar = UINavigationBar.appearance()
        bar.scrollEdgeAppearance = appearance(edge: nil)
        bar.standardAppearance = appearance(edge: UIColor(Theme.line))
        bar.compactAppearance = bar.standardAppearance
    }

    private static func appearance(edge: UIColor?) -> UINavigationBarAppearance {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(Theme.oat)
        appearance.shadowColor = edge ?? .clear
        return appearance
    }
}
