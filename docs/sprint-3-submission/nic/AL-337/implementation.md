# AL-337: As an admin, I manage staff accounts and handle the app's reviews and support requests

## What was built

Seamus asked for an admin who can set up broker and underwriter accounts, so I added a fourth role, `admin`. Before building it I agreed the scope with Dumi on 24 Nov. Admins are only ever made by a script and the app only creates, changes, disables or deletes brokers and underwriters.

An admin signs in on the normal portal login page and lands on a dashboard. It shows staff counts, open support requests, the average review and the recent admin activity.

- **Staff page:** the admin creates a broker (with firm) or an underwriter. al-core makes the Firebase account with no password, sets the role on the account's token and writes the staff profile. Firebase then emails the person a set-your-password link, so no password ever passes through the admin. The admin can also disable, re-enable, change role or delete.
- **Guards:** al-core refuses a delete or role change for a broker who still has borrowers or applications, or an underwriter with sign-offs. The portal then offers "Disable instead".
- **Activity log:** every change is written to `admin_actions` and shows in the activity on the dashboard.
- **Inbox:** lists the reviews and support requests borrowers send from the app. The admin can add notes, resolve a request with a note and reopen it.
- **Business view (read-only):** applications, users, AI runs and the audit trail. Opening an application shows the loan file with the committee console and no controls.

The Firestore rules let admins read everything they need and write nothing from the browser. Every change goes through al-core. Underwriters lost read access to `reviews` and `support_requests`, since no underwriter screen used them.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#284](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/284) | AL-337 Add the admin portal, smoother loading and live committee progress | 2026-11-25 | Nic |

All five subtasks went in this one PR:

| Subtask | What | Where |
|---|---|---|
| AL-338 | al-core: admin role and the staff accounts API (`/core/admin/staff`) | `al-core/app/admin.py`, `admin_actions.py` |
| AL-339 | al-core: admin rules and closing support requests | `al-core/firestore.rules`, `firestore.indexes.json`, `app/support_requests.py`, `SCHEMA.md` |
| AL-340 | Portal: admin sign-in routing and the staff page | `al-web/src/pages/admin/StaffPage.tsx`, `StaffDialogs.tsx`, `routes.tsx` |
| AL-341 | Portal: reviews and support requests inbox | `al-web/src/pages/admin/InboxPage.tsx`, `SupportRequestsPanel.tsx`, `ReviewsPanel.tsx` |
| AL-342 | Portal: read-only business view | `al-web/src/pages/admin/business/` |

The same PR also carried two other tickets, the smoother portal loading (AL-343) and the live committee progress (AL-344).

## One thing that went wrong

The al-core part, including the `firestore.rules` change, went in this PR. Dumi and I had agreed AL-338 and AL-339 would each be their own PR to him, since `al-core/` is his folder. He reviewed the core side after it merged on 26 Nov and said the code was fine, but rules changes go on their own PR to him from now on.

## Tests

- #284 PR body: portal 1021 passed, al-core 981 passed, Firestore rules 593 passed and al-ai 1347 passed.
- Re-run by me on 26 Nov on `main` at `ebcfa88` (`../evidence/10-admin-tests-26-nov.txt`):
  - al-core admin, support and review tests: 181 passed.
  - Rules tests: 208 passed.
  - Portal admin tests: 141 passed.
  - Portal sign-in routing tests: 44 passed.
- Results against each acceptance criterion are in `test-case.md`.
