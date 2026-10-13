import FirebaseAuth
import XCTest
@testable import AgenticLender

final class AccountErrorTests: XCTestCase {
    private func authError(_ code: AuthErrorCode) -> NSError {
        NSError(domain: AuthErrorDomain, code: code.rawValue)
    }

    func testMapsTheFirebaseErrorsTheBorrowerCanActOn() {
        XCTAssertEqual(AccountError(authError: authError(.emailAlreadyInUse)), .emailAlreadyInUse)
        XCTAssertEqual(AccountError(authError: authError(.invalidEmail)), .invalidEmail)
        XCTAssertEqual(AccountError(authError: authError(.weakPassword)), .weakPassword)
        XCTAssertEqual(AccountError(authError: authError(.networkError)), .network)
    }

    func testOtherFirebaseCodesAreUnknown() {
        XCTAssertEqual(AccountError(authError: authError(.internalError)), .unknown)
    }

    func testErrorsFromOtherDomainsAreUnknown() {
        XCTAssertEqual(AccountError(authError: NSError(domain: "Other", code: 17007)), .unknown)
    }

    func testEmailErrorsBelongToTheEmailField() {
        XCTAssertEqual(AccountError.emailAlreadyInUse.field, .email)
        XCTAssertEqual(AccountError.invalidEmail.field, .email)
        XCTAssertNil(AccountError.network.field)
    }
}
