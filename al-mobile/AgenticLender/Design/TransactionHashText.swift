import SwiftUI
import UIKit

/// A transaction hash that wraps at any character, never hyphenates, and can be selected and copied (AL-285).
///
/// SwiftUI's `Text` hyphenates a long unbroken word where it wraps, so a hash showed a "-" that isn't part of it.
/// Splitting the hash or adding invisible break characters would change what gets copied, so this uses a
/// read-only `UITextView` set to wrap by character with hyphenation off.
struct TransactionHashText: UIViewRepresentable {
    let hash: String

    /// Footnote's size at the default Dynamic Type setting.
    private static let footnoteBaseSize: CGFloat = 13

    func makeUIView(context: Context) -> UITextView {
        Self.makeTextView(hash)
    }

    func updateUIView(_ view: UITextView, context: Context) {
        guard view.text != hash else { return }
        Self.apply(hash, to: view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIView.layoutFittingExpandedSize.width
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: fitted.height)
    }

    static func makeTextView(_ hash: String) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.textContainer.lineBreakMode = .byCharWrapping
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        apply(hash, to: view)
        return view
    }

    private static func apply(_ hash: String, to view: UITextView) {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byCharWrapping
        style.hyphenationFactor = 0
        style.usesDefaultHyphenation = false
        // Scaled from footnote's default size, so it follows Dynamic Type like the SwiftUI text around it.
        let font = UIFontMetrics(forTextStyle: .footnote)
            .scaledFont(for: .monospacedSystemFont(ofSize: footnoteBaseSize, weight: .regular))
        view.attributedText = NSAttributedString(string: hash, attributes: [
            .font: font,
            .foregroundColor: UIColor(Theme.text),
            .paragraphStyle: style,
        ])
        view.accessibilityValue = hash
    }
}
