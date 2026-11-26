# Use case: AL-13 Support & Reviews

## Overview

| Item | Detail |
|---|---|
| Epic | AL-13 Support & Reviews |
| Feature (from the brief) | "Mobile: Support & Reviews: automated customer support forms" and "in-app rating/review submission". |
| Owner | Ibrahima Toure (iOS, AL-149 and AL-150). The endpoints are Dumi's (AL-73, AL-74). |
| Sprint | Sprint 3 (16 to 28 Nov 2026). |
| Wireframes | Figma support frames 19 to 21a and review frames 22 to 22c: [22 Rate the app](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=9-220), [22a Filled in](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=9-264), [22b Thanks](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=9-309), [22c Editing](https://www.figma.com/design/l1dzCYxViJsNVEceRstuH1?node-id=9-351). Also `AL-45/wireframe.png` and `AL-46/wireframe.png` in this folder. |

## Goal

- **Support:** As a borrower, I want to send a support request from the app and get an immediate reply, so that I know my problem has been received.
- **Review:** As a borrower, I want to rate the app and leave a review, so that the team knows what works and what doesn't.

## Actors

- **Borrower:** signed in to the iOS app.
- **al-core:** saves support requests (`POST /core/support-requests`) and the one review per borrower (`PUT /core/reviews/me`).
- **Underwriter:** reads every support request and review in Firestore.

## Preconditions

- The borrower is signed in to the iOS app.

**Trigger:** on the Profile tab, the borrower taps Help and support (support) or Rate the app (review).

## Main flow

**Support request**

1. The app shows Contact support, reminding the borrower to message their broker for questions about the mortgage itself.
2. The borrower picks a category (Account, Application, Payment, Other), writes a subject and a message, and, if they have an application, leaves "Include my application reference" switched on.
3. The borrower taps Send. The app sends it to al-core (`POST /core/support-requests`).
4. al-core saves it with the borrower's id and status `open`, and returns a reference.
5. The app shows Request sent: "Thanks, we've received your request SR-… and will reply within 2 working days."

**Review**

1. The app shows Rate Agentic Lender: "Your review helps the team improve the app."
2. The borrower picks 1 to 5 stars and can add a comment.
3. The borrower taps Submit. The app sends it to al-core (`PUT /core/reviews/me`).
4. al-core saves one review for the borrower.
5. The app shows Thanks for your review, with the comment quoted, and Edit review.

## Alternative flows

- **A. No application.** In the support form, the application reference switch doesn't show.
- **B. Editing a review.** The borrower opens Rate the app again (or taps Edit review): the form opens with their saved stars and comment and "You reviewed on {date}". Updating replaces the same review and keeps its first date.

## Exceptions

- **Missing fields:** Send on an incomplete support form outlines the empty fields ("Choose a category", "Add a subject", "Tell us what's happening"). Text of only spaces counts as empty.
- **Sending fails:** the text is kept, with "We couldn't send your request. Check your connection and try again." and a Try again button. For a review: "We couldn't save your review. Check your connection and try again."
- **No star yet:** Submit stays disabled until a star is chosen.
- **Comment too long:** over 500 characters, the comment can't be submitted. (Known gap AL-317: the app and al-core count multi-part emoji differently.)

## Postconditions

- **Support:** a document `support_requests/{reference}` with the borrower's id, the category, subject and message, the application id if included, and status `open`.
- **Review:** one document `reviews/{uid}` with the rating, the comment (or none), `createdAt` from the first review and `updatedAt` from the latest.

## Business rules

- A borrower reads only their own support requests; underwriters read all of them.
- One review per borrower: the document id is the borrower's uid, which al-core takes from the sign-in token, never from the request.
- A borrower can't change anyone else's review (rules tests).

## Stories in this epic

| Story | Title | Owner | Status |
|---|---|---|---|
| AL-45 | As a borrower, I submit a support request from the app | Ibrahima | Done |
| AL-46 | As a borrower, I rate and review the app | Ibrahima | Done |
