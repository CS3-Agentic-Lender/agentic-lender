# AL-43: As a broker, I reply to borrower messages from the portal

## What was built

A Messages page for brokers: one thread per client application, unread first, with the last message and an unread count, and a conversation view to read and reply. Replies go through al-core, which sets the sender and role.

## Pull requests: web portal

| PR | Title | Merged | By |
|---|---|---|---|
| [#193](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/193) | AL-164 Add the broker messages inbox with unread threads first | 2026-11-13 | Nikoloz |

## Pull requests: backend this story depends on

| PR | Title | Merged | By |
|---|---|---|---|
| [#150](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/150) | AL-70 Add the endpoints to send a message and mark messages read | 2026-10-30 | Dumi |
| [#164](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/164) | AL-71 Track what each person has read of a message thread | 2026-11-05 | Dumi |
