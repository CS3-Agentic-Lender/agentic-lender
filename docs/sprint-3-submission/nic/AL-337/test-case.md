# Test case: AL-337

As an admin, I manage staff accounts and handle the app's reviews and support requests

| Item | Detail |
|---|---|
| Story | [AL-337](https://alprojectcs3.atlassian.net/browse/AL-337) |
| Subtasks | AL-338 al-core staff API, AL-339 al-core rules and closing support requests, AL-340 portal sign-in routing and staff page, AL-341 portal inbox, AL-342 portal read-only business view |
| Epic | AL-336 Administration |
| Owner | Me (Nic) |
| Sprint | Sprint 3 (16 to 28 Nov 2026). Added on 24 Nov |
| PR | [#284](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/284), merged 25 Nov |
| Wireframe | `wireframe.png` (source `wireframe.html`) |
| Jira status on 26 Nov | Done |

## Changes to the criteria

On 24 Nov I agreed some changes with Dumi and wrote them on the ticket. Where they differ from the original criteria, they win:

- Admins are only made by a script. The portal and the API create, change, disable and delete **brokers and underwriters only** and admins show in the staff list with no actions. That replaces the "create an admin" part of criterion 2 and the "last admin" part of criterion 6.
- A read-only business view for admins (applications, users, AI runs, audit) was added as AL-342.
- In the portal a closed support request shows as "Resolved". It's stored as `closed`.

## Evidence used

- Tests I ran on 26 Nov at about 20:55 UTC on `main` at `ebcfa88` (`../evidence/10-admin-tests-26-nov.txt`):
  - al-core admin, support and review tests: 181 passed.
  - Firestore rules tests on the emulator: 208 passed.
  - Portal admin tests: 141 passed.
  - Portal sign-in routing tests: 44 passed.
- The #284 PR body. Before merging I checked these by hand in Chrome on the local emulators:
  - creating, disabling, re-enabling, role-changing and deleting staff accounts
  - adding notes, resolving a support request with a note and reopening it
  - the chart tooltips
  - the pages at phone width.
- A live check on 26 Nov at 21:00 UTC (`../evidence/09-live-admin-endpoint-26-nov.txt`), plus the portal deploy run after the merge.

## Results

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | An admin signs in on the normal login page and lands on the admin dashboard. Anyone else gets the forbidden page and every admin API refuses them with 403 | Run `auth-routing.test.tsx`, `admin-loan-file.test.tsx` and `test_admin.py` | Admin lands on Dashboard. An underwriter on an admin page sees "Not allowed". Borrower, broker and underwriter get 403 on every staff endpoint and nothing changes | All three pass. The whole `/admin/*` route sits behind a role check for `admin` only (`routes.tsx`) | Pass |
| 2 | The admin creates a broker (with firm) and an underwriter. Each gets the right claim, a staff profile with no address fields and a set-your-password email. Each can then sign in to their own home | `test_admin.py` create tests; `admin-staff.test.tsx` "creates a broker with a firm and sends the set-your-password email" and "creates an underwriter with no firm"; manual create on the emulators (#284) | Account made with no password, `role` claim set, `users/{uid}` with name, email, phone, role, firm (brokers), `disabled` and `createdAt` but no address | Tests pass and the stored profile has exactly those fields. Created by hand on the emulators before merge | Pass for creating. **Not run** for "the new person signs in and lands on their home": nothing saved shows it |
| 3 | The admin sees every staff account and can disable and re-enable one. A disabled account can't sign in | `test_admin.py` list, disable and enable tests; `admin-staff.test.tsx` list, disable and enable tests; manual on the emulators (#284) | Staff list with name, email, role, firm, status and created date. Disable blocks sign-in and revokes sessions. Enable undoes it | Tests pass. Disabled and re-enabled by hand before merge | Pass |
| 4 | A role change takes effect at the next sign-in and their open session is revoked | `test_a_role_change_sets_the_claim_and_profile_and_revokes_sessions` and the role change tests in `admin-staff.test.tsx` | New claim and profile role, sessions revoked | Pass. Role changed by hand on the emulators before merge | Pass |
| 5 | Delete or role change is refused with a clear message for a broker with borrowers or applications, or an underwriter with sign-offs. A delete with nothing attached removes the account and profile | `test_a_broker_with_borrowers_cannot_be_deleted_or_moved`, `test_a_broker_with_applications_but_no_borrowers_left_is_refused`, `test_an_underwriter_with_sign_offs_cannot_be_deleted_or_moved`, `test_deleting_an_account_with_nothing_attached_removes_it`; portal "keeps the row and shows the reason when a delete is refused" | Refused with the reason. The portal offers "Disable instead". A clean delete removes both | All pass | Pass |
| 6 | (Changed on 24 Nov) No one can be made an admin or stop being one through the app. Admin rows have no actions | `test_no_one_can_be_made_an_admin_or_a_borrower`, `test_an_admin_or_a_borrower_cannot_be_changed_or_deleted`, `test_another_admin_is_refused_too`; portal "shows admin rows without actions, and marks the signed-in admin" | Refused by the API. No buttons on admin rows | All pass | Pass |
| 7 | The admin sees the reviews and support requests from the app newest first and can close a request, which then shows as closed (Resolved). A review and a request sent from the iOS app on the emulator show up | `admin-inbox.test.tsx`, `test_support_close.py`; manual resolve and reopen on the emulators (#284) | Lists newest first. Resolve shows it under Resolved, reopen moves it back | Tests pass. Resolved and reopened by hand before merge | Pass for the inbox. **Not run** for "sent from the iOS app on the emulator": nothing saved shows an end-to-end run from the phone |
| 8 | Underwriters can no longer read `reviews` or `support_requests` and admins can | `rules.test.js` on the Firestore emulator | "An underwriter can't read a review (AL-339)", "an underwriter can't read a support request" and "an admin can read …" all pass | 208 passed | Pass |
| 9 | Every admin action shows in the recent activity with who did it and when | `test_each_successful_action_writes_one_record`, `test_refused_and_no_op_calls_write_no_record`; dashboard "lists recent admin actions with who did what to whom" | One `admin_actions` record per change, shown on the dashboard | Pass | Pass |
| 10 | The admin pages use the portal's tokens and components, look like the rest of the portal and work at 375 px wide with no sideways scroll | Manual check in Chrome (#284 PR body: "checked the pages at phone width") | No sideways scroll at phone width | Checked by hand before merge. No screenshot was saved | Pass (manual, PR body only) |
| 11 | `al-core/SCHEMA.md` and `docs/api-design.md` describe the admin role, the staff profile fields, `admin_actions`, the `closed` status and every new endpoint | Read both files on `main` | All of it in those two files | SCHEMA has the admin read rule, `admin_actions` and the `closed` status. api-design has the support request close, reopen and notes endpoints. But the `users` table in SCHEMA still lists only `borrower`, `broker` and `underwriter`, has no `disabled` field and doesn't mark the address fields borrower-only. The four staff endpoints (`/core/admin/staff`) are documented in `al-core/README.md`, not in `docs/api-design.md` | **Fail** (partly met) |
| 12 | Deployed: al-core with `al deploy`, the rules on the hosted Firebase project, the portal through Amplify on merge and the hosted admin account. Checked on the live site | `gh run list --workflow portal.yml`; curl the live staff endpoint without a token | Portal deploy green. Live `/core/admin/staff` exists | Portal deploy for the merge commit `d5cb33f` succeeded on 25 Nov 19:16 UTC. Live `/core/admin/staff` answers 401 (wants a token) while a made-up `/core/admin/` path answers 404, so the deployed al-core has the staff API | Pass for the portal and al-core. **Not run** for the hosted rules deploy, the hosted admin account and a signed-in check on the live site: nothing saved shows them |

## To finish

- Update `al-core/SCHEMA.md` (the `users` table: `admin` role, `disabled`, address fields borrower-only) and move or copy the staff endpoints into `docs/api-design.md`. That's a change in Dumi's `al-core/` folder, so it goes on its own ticket and PR to him.
- Confirm the rules and indexes are deployed to the hosted project (Dumi asked on 26 Nov), then sign in as the hosted admin on `agentic-lender.com` and save a screenshot.
- Send a review and a support request from the iOS app on the emulators and screenshot them in the inbox.
