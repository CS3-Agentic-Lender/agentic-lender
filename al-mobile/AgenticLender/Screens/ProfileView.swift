import SwiftUI

/// The borrower's Profile (AL-312, Figma 19): who is signed in, their broker and Sign out. It opens from
/// the person button on Home until the app has a tab bar.
struct ProfileView: View {
    @Environment(AppSession.self) private var session
    /// Home's model, so a broker changed here shows on Home too.
    let model: HomeViewModel
    let email: String?
    let service: ProfileService
    /// The borrower's newest application, for the support form's reference toggle.
    var applicationID: String?
    @State private var isChangingBroker = false
    @State private var isShowingSupport = false
    @State private var isShowingReview = false

    private var summary: ProfileSummary { ProfileSummary(profile: model.profile, email: email) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Profile")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                header
                rows
                signOut
            }
            .padding(Theme.screenPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.oat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $isChangingBroker) {
            BrokerPickerView(mode: .change(current: model.profile), service: service) { profile in
                model.brokerChanged(profile)
                isChangingBroker = false
            }
        }
        .navigationDestination(isPresented: $isShowingReview) {
            ReviewView(service: APIReviewService.live())
        }
        .navigationDestination(isPresented: $isShowingSupport) {
            SupportFormView(
                service: APISupportService.live(), applicationID: applicationID,
                brokerFirstName: model.brokerName.flatMap(HomeViewModel.firstName(from:))
            )
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text(summary.initials)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.pine)
                .frame(width: 48, height: 48)
                .background(Theme.tint, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(summary.name)
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                if let email = summary.email {
                    Text(email)
                        .font(.subheadline)
                        .foregroundStyle(Theme.mutedText)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("profile.header")
    }

    private var rows: some View {
        VStack(spacing: 0) {
            ForEach(Array(summary.rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { Divider().overlay(Theme.line) }
                rowView(row)
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
    }

    @ViewBuilder
    private func rowView(_ row: ProfileSummary.Row) -> some View {
        switch row {
        case .broker(let name):
            Button { isChangingBroker = true } label: {
                rowLabel("Your broker", value: name)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Change broker")
            .accessibilityIdentifier("profile.broker")
        case .helpAndSupport:
            Button { isShowingSupport = true } label: {
                rowLabel("Help and support", value: nil)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile.support")
        case .rateTheApp:
            Button { isShowingReview = true } label: {
                rowLabel("Rate the app", value: nil)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile.review")
        }
    }

    private func rowLabel(_ title: String, value: String?) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.body)
                .foregroundStyle(Theme.text)
            Spacer(minLength: 8)
            if let value {
                Text(value)
                    .font(.body)
                    .foregroundStyle(Theme.mutedText)
            }
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.mutedText)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: Theme.minTapTarget + 8)
        .contentShape(Rectangle())
    }

    private var signOut: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { session.signOut() } label: {
                Text("Sign out")
                    .font(.body)
                    .foregroundStyle(Theme.error)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget + 8, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardCornerRadius))
                    .overlay(RoundedRectangle(cornerRadius: Theme.cardCornerRadius).stroke(Theme.line))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile.signOut")
            if let error = session.signOutError {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(Theme.error)
                    .accessibilityIdentifier("profile.signOutError")
            }
        }
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        ProfileView(
            model: HomeViewModel(profile: CoreProfile(
                fullName: "Alice Murphy", brokerID: "broker1", brokerName: "Bob Byrne", brokerFirm: "Byrne Mortgages"
            )),
            email: "alice@test.com",
            service: PreviewProfileService()
        )
    }
    .environment(AppSession(state: PreviewSignedInState()))
}
#endif
