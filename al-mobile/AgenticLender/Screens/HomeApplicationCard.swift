import SwiftUI

/// The card at the top of Home (AL-104, Figma Home and 14f): the borrower's newest application with
/// "View status", or "No application yet" with "What can I borrow?". It updates live.
struct HomeApplicationCard: View {
    let model: HomeApplicationCardModel
    let onViewStatus: (String) -> Void

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.screenPadding)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6))
            .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius * 1.6).stroke(Theme.line))
            .onAppear { model.start() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading your application")
                .tint(Theme.pine)
                .foregroundStyle(Theme.mutedText)
                .frame(maxWidth: .infinity)
        case .none:
            noApplication
        case .application(let application):
            applicationCard(application)
        case .failed(let message):
            RetryMessage(message: message) { model.retry() }
        }
    }

    /// Figma 14f "No application".
    private var noApplication: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No application yet")
                .font(.headline)
                .foregroundStyle(Theme.text)
            Text(HomeApplicationCardModel.noApplicationText)
                .font(.subheadline)
                .foregroundStyle(Theme.mutedText)
            NavigationLink(value: Route.affordability) {
                Text("What can I borrow?")
                    .font(.headline)
                    .foregroundStyle(Theme.surface)
                    .frame(maxWidth: .infinity, minHeight: Theme.fieldHeight)
                    .background(Theme.pine, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
            }
            .padding(.top, 8)
            .accessibilityIdentifier("home.applicationCard.borrow")
        }
        .accessibilityIdentifier("home.applicationCard.none")
    }

    /// Figma 14f "Active application".
    private func applicationCard(_ application: HomeApplication) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Your application")
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                Spacer()
                StatusBadge(text: application.badge.text, tone: application.badge.tone)
            }
            if let terms = application.terms {
                Text(terms)
                    .font(.system(.title3, design: .monospaced))
                    .foregroundStyle(Theme.text)
            }
            Text(application.detail)
                .font(.footnote)
                .foregroundStyle(Theme.mutedText)
            Button { onViewStatus(application.id) } label: {
                Text("View status")
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                    .frame(minHeight: Theme.minTapTarget)
            }
            .accessibilityIdentifier("home.applicationCard.viewStatus")
        }
        .accessibilityIdentifier("home.applicationCard")
    }
}
