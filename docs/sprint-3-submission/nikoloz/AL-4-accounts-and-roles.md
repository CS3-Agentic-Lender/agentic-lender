# Use case: AL-4 Accounts & Roles

**Epic.** A borrower registers and signs in on iOS. Portal staff sign in and see the tools and client files allowed by their role.

## What changed in Sprint 3

- AL-311: Home shows a verification reminder for an unverified password account, with Resend email and a 60-second cooldown. Verified and Google-only accounts do not show the banner. Returning to the foreground reloads the account. [PR #244](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/244), merged 18 Nov, 6abd00d.
- AL-313: Home, Property, Messages and Profile tabs each have their own navigation stack. Messages has the unread badge. Switching tabs retains each stack. [PR #237](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/237), merged 18 Nov, dd2fe0d.
- AL-347 replaces both portal role Overview placeholders; see its implementation and test case.

## Overview

| Item | Detail |
|---|---|
| Epic | AL-4 Accounts & Roles |
| Owner | Nikoloz (use case and portal); Ibrahima (mobile); Dumi (core role and assignment rules) |
| Sprint | Sprint 3 update to the Sprint 2 use case |
| Source | origin/main at ebcfa88; earlier accounts-and-roles.pdf used for structure |

## Goal

As a borrower, broker or underwriter, I want to sign in and see the tools for my role, so that client information stays private and I can find my work.

## Actors

- Borrower: registers, signs in and uses the iOS tabs.
- Broker: uses the portal for their own clients.
- Underwriter: uses the portfolio and loan files.
- Firebase Auth: authenticates the person and supplies role claims.
- al-core and Firestore rules: enforce stored profile, assignment and access rules.

## Preconditions

The app or portal can reach Firebase. The account has its assigned role. Seeded emulator accounts can be used for local checks.

**Trigger:** a person opens the app or portal and signs in.

## Main flow

1. The borrower registers or signs in using the app's Firebase authentication.
2. The signed-in borrower opens Home. An unverified password account sees the verification reminder.
3. The borrower can resend the verification email. The banner shows Sent. Check your inbox. during its 60-second cooldown.
4. After following the email link, returning to the app reloads the account and removes the banner once verified.
5. The borrower moves between Home, Property, Messages and Profile. Each tab retains its navigation; Messages shows unread count.
6. Portal staff sign in. Their role leads to the broker or underwriter Overview.
7. Brokers open their own client files; underwriters open the portfolio and permitted loan files.

## Alternative flows

- A Google-only or verified account does not show the verification reminder.
- The borrower can switch tabs while the resend cooldown is retained by MainTabView.
- The original registration, broker selection and portal role flows continue; these Sprint 3 changes add reminder and navigation behaviour.

## Exceptions

- A resend failure shows We couldn't send the email. Try again in a moment.
- Role guards and Firestore rules continue to restrict portal data to the caller's role and assignments.
- No new device or browser verification run is claimed by this use case.

## Postconditions

The signed-in person reaches their role's tools. A verified account no longer needs the reminder; tab navigation remains available.

## Business rules

- Firebase role claims determine role access.
- Email reminder visibility uses password-provider membership and verification state.
- Resend waits 60 seconds after a successful send.
- Each mobile tab has its own navigation stack.
- A broker's data is scoped by brokerId.

## Stories in this epic

AL-311 and AL-313 are the mobile changes in this update. See the earlier use case for the registration, portal access and broker-selection stories.

## Not built yet, and known limits

Code and merge history confirm these changes. The permitted facts do not supply Ibrahima's device test results or test counts. His confirmation is still needed; this document does not mark the mobile flows Pass.

## Notes

Code read on origin/main: Home/EmailVerificationModel.swift, Screens/VerifyEmailBanner.swift and Screens/MainTabView.swift under al-mobile/AgenticLender. This update does not change mobile files.
