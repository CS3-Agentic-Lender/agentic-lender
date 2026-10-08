import SwiftUI

/// The password rules under the password field, ticking off as the borrower types.
struct PasswordChecklist: View {
    let rulesMet: Set<PasswordRule>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(PasswordRule.allCases, id: \.self) { rule in
                let isMet = rulesMet.contains(rule)
                Label {
                    Text(rule.label)
                } icon: {
                    Image(systemName: isMet ? "checkmark.circle.fill" : "circle")
                }
                .font(.footnote)
                .foregroundStyle(isMet ? Theme.success : Theme.mutedText)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(rule.label), \(isMet ? "met" : "not met")")
            }
        }
        .animation(.easeOut(duration: 0.15), value: rulesMet)
    }
}
