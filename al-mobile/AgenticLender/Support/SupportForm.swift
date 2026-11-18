import Foundation

/// What a support request is about (Figma 20b). The raw values are al-core's.
enum SupportCategory: String, CaseIterable, Identifiable, Sendable {
    case account
    case application
    case payment
    case other

    var id: String { rawValue }

    var title: String { rawValue.capitalized }

    /// The SF Symbol beside it in the category sheet.
    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .application: "doc.text"
        case .payment: "creditcard"
        case .other: "ellipsis.circle"
        }
    }
}

/// The support request form (AL-149, Figma 20 and 20a): a category, a subject and a message, all
/// required, and whether to include the borrower's application.
struct SupportForm: Equatable {
    enum Field: Hashable {
        case category
        case subject
        case message
    }

    /// al-core's limit on the subject.
    static let maxSubjectLength = 100
    /// Figma's counter; al-core accepts up to 2,000.
    static let maxMessageLength = 1000

    var category: SupportCategory?
    var subject = ""
    var message = ""
    var includeApplication = true

    private var trimmedSubject: String { subject.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedMessage: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Each field's problem, in the words Figma 20a shows under it. Empty when the form can be sent.
    var errors: [Field: String] {
        var errors: [Field: String] = [:]
        if category == nil { errors[.category] = "Choose a category" }
        if trimmedSubject.isEmpty {
            errors[.subject] = "Add a subject"
        } else if trimmedSubject.count > Self.maxSubjectLength {
            errors[.subject] = "Keep the subject to \(Self.maxSubjectLength) characters"
        }
        if trimmedMessage.isEmpty {
            errors[.message] = "Tell us what's happening"
        } else if trimmedMessage.count > Self.maxMessageLength {
            errors[.message] = "Keep the message to \(Self.maxMessageLength.formatted()) characters"
        }
        return errors
    }

    /// "74 / 1,000" under the message.
    var messageCount: String {
        "\(message.count.formatted()) / \(Self.maxMessageLength.formatted())"
    }

    /// The JSON for `POST /core/support-requests`, or nil while the form has errors. `application_id`
    /// is sent only when the borrower has an application and left the toggle on.
    func body(applicationID: String?) -> Data? {
        guard errors.isEmpty, let category else { return nil }
        var json: [String: String] = ["category": category.rawValue, "subject": trimmedSubject, "message": trimmedMessage]
        if includeApplication, let applicationID { json["application_id"] = applicationID }
        return try? JSONSerialization.data(withJSONObject: json)
    }
}
