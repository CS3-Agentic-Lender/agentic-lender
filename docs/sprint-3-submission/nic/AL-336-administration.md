# Use case: AL-336 Administration

*An admin manages the staff accounts (brokers and underwriters), reads what borrowers send from the app and sees the business read-only.*

| Item | Detail |
|---|---|
| Epic | AL-336 Administration |
| Feature | Asked for by Seamus: an admin who sets up broker and underwriter accounts, plus a way for what borrowers send from the app (reviews and support requests) to reach someone |
| Owner | Me (Nic). The al-core part is in Dumi's folder and was agreed with him on 24 Nov. The portal part was agreed with Nikoloz |
| Sprint | Sprint 3 (16 to 28 Nov 2026). Story AL-337, built in PR #284, merged 25 Nov |
| Wireframe | `AL-337/wireframe.png` |

## Goal

As an admin, I want to set up and manage the brokers and underwriters and see the reviews and support requests borrowers send from the app, so new staff can be added without a script and what borrowers tell us reaches someone.

## Actors

- **Admin:** a staff member with the `admin` role. Admins are only made by a script (`create-hosted-admin.js` on the hosted project, the seed script on the emulators), never from the app.
- **Broker or underwriter:** the staff account being created or changed.
- **Borrower:** sends reviews and support requests from the iOS app.
- **Portal (al-web):** the admin pages under `/admin`.
- **al-core:** the API that makes every change (`/core/admin/staff` and `/core/admin/support-requests/...`).
- **Firebase:** Auth holds the accounts and their role. Firestore holds the profiles, the requests, the reviews and the `admin_actions` log.

## Preconditions

- The admin's account exists and has the `admin` role on its token.
- al-core and the portal are running.
- The Firestore rules let admins read and stop them writing from the browser.

## Trigger

The admin signs in on the portal login page.

## Main flow: add a staff member

1. The admin signs in on the normal login page and lands on the Dashboard. It shows staff counts, open support requests, the average review and the recent activity.
2. The admin opens Staff and presses "New staff member".
3. They fill in full name, email, phone (+353), role (broker or underwriter) and, for a broker, the firm.
4. The portal sends it to al-core (`POST /core/admin/staff`) with the admin's token.
5. al-core checks the caller is an admin. It creates the Firebase account with no password, sets the role and writes the staff profile. It also logs the action in `admin_actions`.
6. The portal has Firebase email the new person a set-your-password link.
7. The new person shows in the staff list and the action shows in the dashboard's recent activity.

## Main flow: handle a support request

1. The admin opens Inbox. Support requests are listed newest first, open ones by default.
2. They read the request (who sent it, subject, message, linked application) and can add notes.
3. They press Resolve, with or without a resolution note. al-core sets the request to `closed` (shown as Resolved) and logs it.

## Alternative flows

**A. Disable or enable.** The admin disables an account after a confirm dialog. al-core blocks the person's sign-in and revokes their sessions. Enable undoes it.

**B. Change role.** The admin moves a broker to underwriter or the other way round. Moving to broker needs a firm. al-core sets the new role and revokes the person's sessions, so the new role applies at their next sign-in.

**C. Delete.** The admin deletes an account with nothing attached. al-core removes the Firebase account and the profile.

**D. Reopen a request.** The admin reopens a resolved request. It goes back to Open, keeps its notes and loses its resolution.

**E. Reviews.** On the Reviews tab the admin sees the average, the count, how many reviews gave each star and each review newest first.

**F. Business view.** The admin opens Business to see applications, users, AI runs and the audit trail, read-only. Opening an application shows the loan file with the committee console and no controls.

## Exceptions

- A broker with borrowers or applications, or an underwriter with sign-offs, can't be deleted or have their role changed. al-core refuses it with the reason and the portal offers "Disable instead".
- An admin row has no actions. No one can be made an admin or stop being one through the app.
- An email that already has an account is refused (409). A missing or bad field is refused and the field is named (422).
- A broker, underwriter or borrower who opens an admin page sees "Not allowed". al-core refuses them with 403 on every admin endpoint.
- A note on a resolved request is refused (409) until the request is reopened.

## Postconditions

- Every change is made by al-core and logged in `admin_actions` with who did it, what they did and when.
- Nothing on the chain or in the audit history is changed by an admin.
- Underwriters can no longer read `reviews` or `support_requests`.
