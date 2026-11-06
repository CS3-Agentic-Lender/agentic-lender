# Agentic Lender: Sprint 2 submission

MTU Year 3 Group Project 2026/27. Sprint 2 runs from 27 October to 15 November 2026.
Team: Ibrahima Toure (iOS borrower app), Nikoloz Chilachava (web portal), Nicholas Groenewald (AI and valuation, group leader), Solomon Sosanya (database and blockchain).

This folder follows the Sprint 1 zip. Nic puts the final zip together.

## Deadlines

| When | What |
|---|---|
| Saturday 14 November | Everyone hands in their folder to Nic |
| Sunday 15 November, 23:59 | Nic uploads the zip to Canvas |

## What is in this zip

| Folder | What it holds |
|---|---|
| `sprint-backlog/` | `Jira.csv`: the Sprint 2 board exported from Jira. Nic exports it on the last day. |
| `nic/`, `nikoloz/`, `ibrahima/`, `dumi/` | One folder per team member. The **use case** for each Epic is a PDF at the top of the folder. Each **Story** has its own folder named by its Jira key, with `wireframe.png` and `test-case.pdf`. Stories with no screen use a flow diagram as the wireframe. |
| `retrospective/` | The Sprint 2 retrospective and review. |
| `code/` | The code on `main` at the end of the sprint (`git archive`, then a secret scan). Nic does this last. |

## What the submission asks for

For each sprint the brief asks for the sprint deliverable and the sprint documentation. This is where each piece lives:

| Asked for | Where it is |
|---|---|
| Sprint deliverable (viable working product, as agreed in the sprint backlog) | `code/` (the code on `main` at the end of the sprint) |
| Sprint backlog outlining the features to be implemented | `sprint-backlog/Jira.csv` |
| Use case for each feature (an Epic, made of several stories) | One PDF per Epic at the top of the owner's folder |
| For each story: wireframe | `<person>/<story>/wireframe.png` |
| For each story: test case | `<person>/<story>/test-case.pdf` |
| For each story: design, if appropriate | `<person>/<story>/design.png` or `design.pdf` |
| For each story: implementation | `<person>/<story>/implementation.md` (merged PR links) plus the code in `code/` |
| Sprint retrospective and review | `retrospective/` |

## Stories in Sprint 2 (wireframe and test case each)

| Story | Owner | Epic | Jira status when prepared | Folder |
|---|---|---|---|---|
| AL-21 As a borrower, I see the current status of my application | Ibrahima | AL-5 Loan Application | Done | `ibrahima/AL-21/` |
| AL-22 As a borrower, I enter property specs (county, size, bedrooms, type, BER) and get a fair valuation | Ibrahima | AL-6 Fair-Price Property Checker | Done | `ibrahima/AL-22/` |
| AL-23 As an underwriter, I compare the seller's asking price against the model's valuation | Nikoloz | AL-6 Fair-Price Property Checker | To Do | `nikoloz/AL-23/` |
| AL-26 As an underwriter, a valuation agent flags overvalued collateral and computes LTV | Nic | AL-7 AI Credit Committee | Done | `nic/AL-26/` |
| AL-27 As an underwriter, a market research agent pulls current central bank rates and mortgage trends | Nic | AL-7 AI Credit Committee | To Do | `nic/AL-27/` |
| AL-28 As an underwriter, a strategist agent decides Approve / Conditionally Approve / Decline and writes a credit memo | Nic | AL-7 AI Credit Committee | Done | `nic/AL-28/` |
| AL-29 As a developer, the agents run on two cloud LLM APIs plus a local Ollama model | Nic | AL-7 AI Credit Committee | In Review | `nic/AL-29/` |
| AL-30 As an underwriter, I read each agent's reasoning trail and the committee's consensus | Nikoloz | AL-7 AI Credit Committee | To Do | `nikoloz/AL-30/` |
| AL-31 As a borrower, I see my estimated LTV, DTI and approval likelihood | Ibrahima | AL-7 AI Credit Committee | In Progress | `ibrahima/AL-31/` |
| AL-33 As an underwriter, I open a loan file with the borrower's full DTI breakdown | Nikoloz | AL-8 Origination Pipeline | To Do | `nikoloz/AL-33/` |
| AL-34 As an underwriter, an application moves through Applied, AI Deliberated, Approved, Funded, Closed | Dumi | AL-8 Origination Pipeline | To Do | `dumi/AL-34/` |
| AL-36 As an auditor, a SHA-256 hash of the credit memo, valuation and approval is stored on-chain | Dumi | AL-9 On-Chain Settlement | To Do | `dumi/AL-36/` |
| AL-37 As an underwriter, signing off an application from the portal triggers the loan note mint | Nikoloz | AL-9 On-Chain Settlement | To Do | `nikoloz/AL-37/` |
| AL-38 As an underwriter, I download a PDF/CSV audit pack for a decision | Nikoloz | AL-9 On-Chain Settlement | To Do | `nikoloz/AL-38/` |
| AL-39 As a borrower, I see my loan note's on-chain lifecycle status | Ibrahima | AL-9 On-Chain Settlement | Done | `ibrahima/AL-39/` |
| AL-42 As a borrower, I message my assigned broker or lending officer in the app | Ibrahima | AL-11 Messaging | Done | `ibrahima/AL-42/` |
| AL-43 As a broker, I reply to borrower messages from the portal | Nikoloz | AL-11 Messaging | To Do | `nikoloz/AL-43/` |
| AL-130 As an underwriter, the credit committee runs end to end on each application and saves one run record | Nic | AL-7 AI Credit Committee | To Do | `nic/AL-130/` |
| AL-131 As a data scientist, the valuation endpoint returns how much each house feature added to or took off the estimate | Nic | AL-14 Valuation breakdown | Done | `nic/AL-131/` |
| AL-132 As a borrower, I see how each detail of the house moved its estimated price | Ibrahima | AL-14 Valuation breakdown | Done | `ibrahima/AL-132/` |
| AL-133 As an underwriter, I see the valuation breakdown in the loan file | Nikoloz | AL-14 Valuation breakdown | To Do | `nikoloz/AL-133/` |
| AL-151 As an underwriter, I sign off an application and my decision is recorded | Nikoloz | AL-9 On-Chain Settlement | To Do | `nikoloz/AL-151/` |
| AL-152 As an underwriter, I reply to a borrower's messages as the bank lending officer | Nikoloz | AL-11 Messaging | To Do | `nikoloz/AL-152/` |
| AL-195 As a homeowner, I apply for a home equity line of credit against my property's value | Ibrahima | AL-194 Home equity line of credit (HELOC) | Done | `ibrahima/AL-195/` |
| AL-196 As an underwriter, I review a HELOC application with its combined LTV and collateral value | Nikoloz | AL-194 Home equity line of credit (HELOC) | To Do | `nikoloz/AL-196/` |
| AL-256 iOS: sign out from Your details | Ibrahima | AL-4 Accounts & Roles | Done | `ibrahima/AL-256/` |

## Use cases (one per Epic)

| Epic | Feature | Owner | File |
|---|---|---|---|
| AL-4 | Accounts & Roles | Nikoloz | carried over from Sprint 1: reuse or update |
| AL-5 | Loan Application | Ibrahima | carried over from Sprint 1: reuse or update |
| AL-6 | Fair-Price Property Checker | Nic | carried over from Sprint 1: reuse or update |
| AL-7 | AI Credit Committee | Nic | carried over from Sprint 1: reuse or update |
| AL-8 | Origination Pipeline | Nikoloz | carried over from Sprint 1: reuse or update |
| AL-9 | On-Chain Settlement | Dumi | carried over from Sprint 1: reuse or update |
| AL-11 | Messaging | to agree | NEW: write a use case |
| AL-14 | Valuation breakdown | Nic | NEW: write a use case |
| AL-194 | Home equity line of credit (HELOC) | Ibrahima | carried over from Sprint 1: reuse or update |
