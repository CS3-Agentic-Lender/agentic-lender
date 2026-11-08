# al-core: Firestore schema

Version 0.2 (draft for team confirmation). Follows the API design doc (AL-199).

## Rules that apply everywhere

- **Clients only read Firestore.** Every write goes through al-core or al-ai using the Admin SDK. The Firestore rules deny all client writes.
- **Field names are camelCase in Firestore.** The APIs use snake_case and convert between the two (`fullName` here is `full_name` in the API).
- **Money** is a euro amount (never cents) in a field ending `Eur`, for example `loanAmountEur`. The API name ends `_eur`.
- **Percentages** are numbers in a field ending `Pct`, where `4.0` means 4%. The API name ends `_pct`.
- **Timestamps** are Firestore timestamps. The API sends them as ISO 8601 UTC strings.
- **Timestamps inside hashed data** use exactly one string format: UTC with milliseconds and a Z, for example `2026-09-18T11:00:00.000Z`. The audit record stores its times as these strings. Stored Firestore timestamps that get hashed, such as `ai_calls.createdAt`, stay as timestamps in Firestore and are converted to this string format before hashing. JavaScript's `toISOString()` gives this format; in Python use `dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')`. Any other format changes the hash.
- **IDs** are strings.

## Collections

| Path | Who reads it | Written by | Holds |
|---|---|---|---|
| `users/{uid}` | That user, their broker, underwriters | al-core (`POST /core/me`) | Profile and chosen broker |
| `applications/{id}` | The borrower, the assigned broker, underwriters | al-core, al-ai | Status, loan terms, results, decision, loan note |
| `applications/{id}/review/underwriting` | The assigned broker, underwriters | al-ai | Risk tier, DTI breakdown, valuation detail |
| `applications/{id}/audit/record` | The assigned broker, underwriters | al-core (at mint) | The record behind the on-chain audit hash |
| `applications/{id}/messages/{messageId}` | The borrower, the assigned broker, underwriters | al-core | The message thread |
| `applications/{id}/readState/{uid}` | That person only | al-core | When that person last opened the thread |
| `ai_runs/{runId}` | The assigned broker, underwriters | al-ai | One record per committee run |
| `ai_calls/{callId}` | The assigned broker, underwriters | al-ai | One record per AI call |
| `support_requests/{requestId}` | The user who sent it, underwriters | al-core (`POST /core/support-requests`) | A support request from a user |
| `reviews/{uid}` | That user, underwriters | al-core | One review per user |
| `users/{uid}/saved_checks/{checkId}` | That user | al-core (`POST` and `DELETE /core/saved-checks`) | A borrower's saved property checks |

**Brokers don't read Drafts.** A Draft is the borrower's working copy, so the rules close `applications/{id}` and its `audit` and `messages` subcollections to a broker while the status is `Draft`. Applied and every later status stay readable to the assigned broker. Borrowers and underwriters are unaffected. Because Firestore rules don't filter results, a broker's application query must exclude Drafts (`where('brokerId', '==', uid).where('status', '!=', 'Draft')`), or Firestore refuses it. That query needs the `brokerId` + `status` index in `firestore.indexes.json`.

## users/{uid}

| Field | Type | Required | Notes |
|---|---|---|---|
| `uid` | string | yes | Same as the document ID and the Firebase Auth uid |
| `role` | string | yes | `borrower`, `broker` or `underwriter`. A copy of the `role` claim on the ID token; the claim is what rules and APIs trust |
| `fullName` | string | yes | |
| `email` | string | yes | Stored in lower case |
| `phone` | string | yes | Starts `+353` |
| `addressLine1` | string | yes | |
| `addressLine2` | string | no | Left out when empty |
| `county` | string | yes | For example `Cork` |
| `eircode` | string | yes | Capitals with a space, for example `A65 F4E2` |
| `brokerId` | string | no | Borrowers only: uid of the chosen broker, set with `PUT /core/me/broker` (AL-142) |
| `firm` | string | no | Brokers only: the firm they work for, shown in the borrower's broker picker |
| `createdAt` | timestamp | yes | Server timestamp |

## applications/{id}

**Required** means required when the application is submitted (Draft → Applied). A Draft only needs `borrowerId`, `brokerId`, `borrowerName`, `status`, `loanType`, `createdAt` and `updatedAt`, so a borrower can save partway through.

### People and status

| Field | Type | Required | Notes |
|---|---|---|---|
| `borrowerId` | string | yes | uid of the borrower |
| `brokerId` | string | yes | uid of the assigned broker. Copied from the borrower's profile when the application is created, and kept if the borrower later changes broker (proposal) |
| `borrowerName` | string | yes | The borrower's `fullName`, copied when the application is created, so a broker can show it even after the borrower moves to another broker and their profile is no longer readable |
| `status` | string | yes | Exactly one of: `Draft`, `Applied`, `AI Deliberated`, `Underwriter Approved`, `Declined`, `Funded`, `Closed`. al-ai matches on these strings |
| `aiRunStatus` | string | no | `running`, `failed` or `complete`. Absent until the first AI run starts |
| `aiRunId` | string | no | The `ai_runs` document of the run that holds the application, written with `aiRunStatus` when the run starts (the committee listener claims the application in one transaction); a re-run replaces it. The failure reason and everything else about the run is on that document, not here, because the borrower can read this one |
| `loanType` | string | yes | `mortgage` or `heloc` |
| `createdAt` | timestamp | yes | |
| `submittedAt` | timestamp | no | Set when the status moves from `Draft` to `Applied` |
| `updatedAt` | timestamp | yes | |
| `statusHistory` | array of maps | no | One entry per status move, oldest first: `from`, `to`, `actor`, `actorId`, `at`. Written only by the API (`app/status.py`), never edited. `actor` is `borrower`, `committee`, `underwriter` or `mint`; `actorId` is the person's uid, or the service name (for example `al-ai`) for the committee and the mint. `at` is a UTC timestamp. Absent on an application that has never moved (a Draft) and on seeded applications. The app's timeline reads it |

The only moves, and the actor each belongs to (a move by anyone else is refused, and any other move is refused whoever asks): `Draft` to `Applied` (borrower), `Applied` to `AI Deliberated` (committee), `AI Deliberated` to `Underwriter Approved` or `Declined` (underwriter), `Underwriter Approved` to `Funded` (mint), `Funded` or `Declined` to `Closed` (underwriter). The table lives in `app/status.py`; every endpoint that changes `status` builds its write with `plan_move`.

### Borrower inputs

| Field | Type | Required | Notes |
|---|---|---|---|
| `grossIncomeEur` | number | yes | Yearly gross income |
| `monthlyDebtsEur` | number | yes | Existing monthly debt repayments |
| `monthlyTakeHomeEur` | number | yes | Net monthly pay |
| `monthlyLivingCostsEur` | number | yes | Monthly living costs excluding debt repayments |
| `employmentType` | string | yes | `employed`, `self_employed` or `other` |
| `yearsInCurrentJob` | number | yes | |
| `applicants` | string | yes | `single` or `joint`. For joint applications the income and debt fields hold combined amounts |
| `existingMortgageBalanceEur` | number | HELOC only | Outstanding balance on the home |
| `depositEur` | number | mortgage only | |
| `firstTimeBuyer` | boolean | mortgage only | Sets the income multiple (4x first-time, 3.5x otherwise) |
| `loanAmountEur` | number | yes | Amount requested. For a HELOC, the requested credit limit |
| `termYears` | number | yes | Whole years, 5 to 35 (the range the AI committee and the affordability check work for). The API refuses anything else on create, edit and submit; the loan note contract's own limit of 40 years stays as the hard limit on the chain |
| `property` | map | yes | See below |

`property` map:

| Field | Type | Notes |
|---|---|---|
| `addressLine1` | string | Typed in by the borrower. Needed to submit |
| `addressLine2` | string | Optional |
| `eircode` | string | Capitals with a space (`A65 F4E2`), the same rule as the profile. Needed to submit |
| `county` | string | From `GET /ai/valuation/options`. Needed to submit |
| `propertyType` | string | From `GET /ai/valuation/options`. Needed to submit (the valuation uses it) |
| `bedrooms` | number | Needed to submit (the valuation uses it); `0` counts |
| `floorAreaSqm` | number | Needed to submit (the valuation uses it) |
| `berRating` | string | From `GET /ai/valuation/options`. Needed to submit (the valuation uses it) |
| `askingPriceEur` | number | Mortgage only: needed to submit a mortgage (the purchase-price LTV is worked out from it). A HELOC has none, because it is borrowed against a home the borrower already owns; its value is the valuation estimate, and the API refuses an asking price on a HELOC |

### Results and decision

| Field | Type | Required | Notes |
|---|---|---|---|
| `estimatedValueEur` | number | no | From `POST /ai/valuation` |
| `ltvPct` | number | no | Loan to value, against the valuation estimate: (loanAmountEur / estimatedValueEur) * 100 for a mortgage, and (existingMortgageBalanceEur + loanAmountEur) / estimatedValueEur * 100 (combined LTV) for a HELOC. **Which figure a card shows:** a purchase reads `purchaseLtvPct`, a HELOC reads `ltvPct`. Whether to use the lower of the valuation and the asking price is an open question |
| `dtiPct` | number | no | Debt to income at the benchmark rate, to one decimal place. The stressed figure and every other part are in `review/underwriting.dtiBreakdown` |
| `aprPct` | number | no | Rate offered. Until pricing exists it is the benchmark rate used (`dtiBreakdown.benchmarkRatePct`). If it is still unset when the loan note is minted, the mint saves the rate it put on the note here, in the same write as `loanNote`, so a borrower (who can't read `review/underwriting`) always sees the rate on their note |
| `purchaseLtvPct` | number | no | Purchases only: (loanAmountEur / property.askingPriceEur) * 100, to one decimal place. Set by al-ai after each run. A HELOC has none, because it has no asking price |
| `approvalLikelihood` | string | no | What the borrower is shown, never a percentage: `Unknown`, `Low`, `Medium` or `High`. Set by al-ai after each run, by its rule order: incomplete or unsupported inputs give `Unknown`, adverse stressed affordability `Low`, any caution band or limit breach `Medium`, otherwise `High`. Indicative, and separate from the committee's recommendation. Absent until the first run, and the app treats an absent label as `Unknown`. There is no percentage field: al-ai does not write `approvalLikelihoodPct` any more (agreed on the LTV, DTI and approval likelihood ticket, 29 Oct) |
| `ltvBand` | string | no | `80_or_less`, `80_to_90` (over 80 up to 90) or `over_90`, from the LTV the underwriter judges the loan on: against the asking price for a mortgage (`loanAmountEur / property.askingPriceEur`), and against the valuation estimate for a HELOC (`(existingMortgageBalanceEur + loanAmountEur) / estimatedValueEur`, because a HELOC has no asking price). Set by al-ai with the tier. The underwriter's queue filters on it with `status` |
| `riskTier` | string | no | `A`, `B`, `C` or `D`, by the risk tier rule below. Set by al-ai after each run, with the same value as in `review/underwriting`. Here so the queue can filter on it with `status`; the borrower can read it, like `ltvPct` |
| `decision` | map | no | Set by the underwriter. See below |
| `loanNote` | map | no | Set at mint. See below |
| `feeStatus` | string | no | `unpaid` or `paid` (EUR 150 appraisal fee) |
| `feeIntentId` | string | no | Stripe payment intent id |
| `auditTxHash` | string | no | The transaction that wrote the audit hash to the registry, set by `audit_store.anchor`. Kept as first written: a retry that finds the hash already stored leaves it alone. The loan note's own mint transaction is `loanNote.txHash` |

`decision` map: `outcome` (`approved` or `declined`), `underwriterId`, `decidedAt`, `reason` (optional, left out when none is given). Written only by `POST /core/applications/{id}/decision`, in the same write that moves the status to `Underwriter Approved` or `Declined`, and never changed afterwards.

`loanNote` map: `tokenId` (text), `contractAddress`, `txHash` (the mint transaction), `auditHash`, `network` (the name of the chain it was minted on, from `CHAIN_NETWORK`: `localhost` on the local Hardhat node; absent on a note saved before this field existed), `mintedAt`, and, once the application is closed, `closedAt` (when the note was closed on the chain: the chain's own time for it, so a retry saves the same value) and `closeTxHash` (the closing transaction). The note's principal, rate and term are the application's own `loanAmountEur`, `aprPct` and `termYears`, which the mint saves as they are. When the mint finds a note already on the chain for the application (a mint that was cut short), it first checks that note's terms against these and refuses if they differ. No personal data goes on chain. Everything but `closedAt` and `closeTxHash` is written only by `POST /core/applications/{id}/mint`, in the same write that moves the status to `Funded`, and never changed afterwards. `closedAt` and `closeTxHash` are written only by `POST /core/applications/{id}/close`, in the same write that moves the status to `Closed`, and never changed afterwards. A Declined application has no `loanNote`, so closing it adds none.

## applications/{id}/review/underwriting

Underwriter-only details, kept in a separate document so borrowers can't read them.

| Field | Type | Notes |
|---|---|---|
| `applicationId` | string | The parent application's id |
| `brokerId` | string | Copied from the application, so a collection-group query and its rule can check broker access |
| `riskTier` | string | `A`, `B`, `C` or `D` |
| `policyGate` | map | What the policy gate returned for the run (al-ai `policy_gate.py`), saved exactly as returned. See below |
| `dtiBreakdown` | map | Every part of the debt-to-income calculation, at the benchmark rate and at the stressed rate. See below |
| `valuationDetail` | map | What the valuation model returned for the home, as al-ai saves it after each run. See below |
| `updatedAt` | timestamp | |

### policyGate

Written by al-ai after each run, with the Admin SDK; no client can write it. The gate is code, not the AI: it stops a plain Approve on a loan that breaks a Central Bank limit, and it never makes a recommendation more favourable. The portal shows these so the underwriter sees which limit was broken.

| Field | Type | Notes |
|---|---|---|
| `original` | string | What the strategist recommended: `Approve`, `Conditionally Approve` or `Decline` |
| `effective` | string | What the underwriter is shown as the recommendation, same three values. `Approve` with a breach becomes `Conditionally Approve`; a `Decline` stays a `Decline` |
| `conditions` | list of text | The strategist's conditions plus one per breach, such as `Requires lender exception review (LTI_CAP)`, plus `Requires an independent surveyor's valuation (HELOC)` on every HELOC (the home is already owned, so the model's estimate is the only value until a surveyor sees it; policy, not a breach). A condition makes an `Approve` a `Conditionally Approve`. Empty for a `Decline` |
| `breaches` | list of text | The rule IDs broken, always recorded, even for a `Decline`: `LTI_CAP` (a purchase over 4x income for a first-time buyer, otherwise 3.5x; a HELOC counts the existing mortgage plus the line, always 3.5x), `LTV_CAP` (a purchase over 90% of the asking price) and `CLTV_CAP` (a HELOC over 80% of the home's value, the valuation estimate). Exactly on a limit is not a breach |
| `changed` | boolean | Whether the recommendation or its conditions differ from what the strategist wrote |

### valuationDetail

Written by al-ai after each run (`write_valuation`, with the Admin SDK); a re-run replaces the whole map and no client can write it. The portal reads it from here instead of calling `/ai/valuation` on every render. Every key is always present, `null` when unknown. It is an estimate of a 2024 asking price, not a valuation.

| Field | Type | Notes |
|---|---|---|
| `estimatedValueEur` | number | The model's estimate. The same figure as `estimatedValueEur` on the application |
| `displayEstimateEur` | integer | The estimate to the nearest EUR 1,000, the figure to show |
| `askingPriceGap` | number or null | Asking price over estimate, minus 1, signed (0.047 means the asking price is 4.7% over). Null for a HELOC, which has no asking price |
| `priceNeedsReview` | boolean or null | True when the asking price is over the estimate by more than the model's calibrated threshold (35.7% for `v2`; `v1` used 43.3%). The threshold is `threshold` in `al-ai/models/valuation/manifest.json`, so it changes with the model version. Null for a HELOC |
| `supportWarnings` | list of text | Why the estimate may be less reliable, such as an Eircode area the model has not seen. Empty when there is nothing to warn about |
| `modelVersion` | string | The valuation model's version, such as `v2` |
| `baselineEur` | number or null | The model's average estimate over its sample homes: the starting point of the breakdown |
| `contributions` | list or null | The breakdown: one item per input (`county`, `property_type`, `bedrooms`, `floor_area`, `ber`, `eircode_area`), biggest effect first ignoring the sign. Each is `{feature, value, eur}`: the input's value for this home (`eircode_area` is the routing key only) and the euro it added to the estimate or took off it. `baselineEur` plus every `eur` is the estimate. Null together with `baselineEur`, never just one, when only the breakdown could not be worked out; the estimate is still good then |

### dtiBreakdown

Written only by the API (al-ai, after each run, with the Admin SDK). No client can write it: the rules have no write access anywhere, and a rules test checks it. The figures come from al-ai's affordability module (`assess()` in `al-ai/app/affordability.py`). Money is euro to the cent, never cents, and percentages are plain numbers (`4.0` means 4%). The bands follow the stressed figures.

| Field | Type | Notes |
|---|---|---|
| `incomeMonthlyEur` | number | Gross income per month, **combined** for a joint application. The form collects one household figure, so there is no per-applicant income |
| `takeHomeMonthlyEur` | number | Net monthly pay, from the application's `monthlyTakeHomeEur` |
| `existingDebtsMonthlyEur` | number | From the application's `monthlyDebtsEur` |
| `livingCostsMonthlyEur` | number | From the application's `monthlyLivingCostsEur` |
| `newRepaymentMonthlyEur` | number | The new loan's monthly repayment at the benchmark rate |
| `stressedRepaymentMonthlyEur` | number | The same at the stressed rate |
| `benchmarkRatePct` | number | The benchmark mortgage rate used |
| `stressMarginPct` | number | The stress margin, 2.0 (Central Bank rule) |
| `stressedRatePct` | number | `benchmarkRatePct` plus `stressMarginPct` |
| `rateDate` | string | The month the benchmark rate is from, `YYYY-MM` |
| `dtiPct` | number | (existing debts + new repayment) / gross monthly income, at the benchmark rate. The application's own `dtiPct` is the same figure to one decimal place |
| `stressedDtiPct` | number | The same at the stressed rate |
| `surplusMonthlyEur` | number | Take-home pay minus living costs, existing debts and the new repayment, at the benchmark rate |
| `stressedSurplusMonthlyEur` | number | The same at the stressed rate |
| `dtiBand` | string | `Comfortable` (stressed DTI up to 40%), `Caution` (up to 50%) or `Adverse` |
| `surplusBand` | string | `Comfortable` (stressed surplus 500 or more), `Caution` (0 or more) or `Adverse` |

`al-core/test/dti-reference-cases.json` holds al-ai's output for the two affordability reference cases, and the seed's port of the module is tested against it.

## applications/{id}/audit/record

Written once at mint. Declined applications have none. The audit hash is the SHA-256 of the record **without** its `auditHash` field, serialised with `json.dumps(record, sort_keys=True, separators=(",", ":"))`. To verify a loan, remove `auditHash` from the stored record, hash the rest the same way, and compare with the on-chain value.

The one function that does this is `audit_hash(record)` in `al-core/app/audit.py` (`utc_iso` there formats times). al-ai uses the same rules for the per-call hashes. The shared examples are in `al-core/test/audit-hash-vectors.json`: each is a record and its expected hash, built from the hashes `scripts/seed.js` writes (the audit records and the `ai_calls` documents they list). Rebuild the file with `node scripts/audit-vectors.js --write` after the seed's audit records change; a Jest test fails if it is out of date. Non-ASCII text is escaped as Python's `json.dumps` does it (an accented e is hashed as backslash, u, 0, 0, e, 9, never as the raw character), and one vector (`non-ascii:...`) checks it, so al-ai must escape the same way.

| Field | Type | Notes |
|---|---|---|
| `applicationId` | string | |
| `decision` | string | |
| `loanType` | string | `mortgage` or `heloc`, as on the application |
| `principalCents` | integer | The loan amount in euro cents: `loanAmountEur` times 100, a half rounded up. A whole number, written with no decimal point or exponent |
| `termMonths` | integer | The term in months: `termYears` times 12. A whole number |
| `riskTier` | string | |
| `creditMemo` | string | |
| `underwriterId` | string | |
| `signedOffAt` | string | UTC with milliseconds and Z (see the timestamp rule above), so the hash is reproducible |
| `aiCalls` | array | Each item: `id` and `sha256` of that `ai_calls` document |
| `auditHash` | string | The SHA-256 stored on chain |

## applications/{id}/messages/{messageId}

| Field | Type | Notes |
|---|---|---|
| `senderId` | string | uid |
| `senderRole` | string | `borrower`, `broker` or `underwriter` |
| `text` | string | |
| `sentAt` | timestamp | |
| `read` | boolean | Whether the other side has read it: a message from the borrower is read when a broker or an underwriter opens the thread, and a message from the broker or an underwriter is read when the borrower does. Starts `false`. Set only through `POST /core/applications/{id}/messages/read`. Messages between the broker and an underwriter are not cleared by it: use `readState` below for a per-person count |

Written only by the API: `POST /core/applications/{id}/messages` sets `senderId` and `senderRole` from the token and `sentAt` on the server, and there is no way to edit or delete a message. A thread opens when the application is submitted, because a broker can't see a Draft.

## applications/{id}/readState/{uid}

When one person last opened the thread. There is one document per person, named by their uid, and a person can read only their own. It is what gives the borrower, the broker and each underwriter their own unread count; the `read` flag on a message is a different thing (see above).

| Field | Type | Notes |
|---|---|---|
| `lastReadAt` | timestamp | The `sentAt` of the newest message in the thread when the person opened it, not the time of the request, so a message that arrives while they open it is still unread for them. It only moves forward when the thread is opened with something new in it; two opens by the same person at the very same moment could in theory write them out of order, and the next open puts it right |
| `role` | string | `borrower`, `broker` or `underwriter` |

Written only by the API, by `POST /core/applications/{id}/messages/read`, for the caller. Absent until the person first opens the thread, which means everything sent by anyone else is unread. The unread count is the messages sent by someone else after `lastReadAt`; `GET /core/applications/{id}/messages/unread` gives it, and an app can work it out itself by listening to the thread and to its own `readState` document.

## ai_runs/{runId}

One document per committee run, so the portal's deliberation console can show each agent's report and vote and the committee's consensus. Written by al-ai with the Admin SDK: created when the listener claims an application, finished when the run ends. Underwriters read every run, a broker only runs whose copied `brokerId` is theirs, a borrower none, and no client writes. The layout was agreed with Nic on the reasoning-trail ticket. The calls behind a run are in `ai_calls` (each with the run's id), and a failed run keeps the reason here, never on the application.

| Field | Type | Notes |
|---|---|---|
| `applicationId` | string | |
| `brokerId` | string | Copied from the application so the rules can check broker access |
| `status` | string | `running`, `failed` or `complete`. The audit record only uses a `complete` run |
| `trigger` | string | `submit` or `rerun` |
| `startedAt` | timestamp | The audit record picks the latest complete run by this |
| `finishedAt` | timestamp or null | Null while the run is `running` |
| `rerunOf` | string or null | The failed run this one repeats |
| `failedStep` | string or null | The step that failed: `validate`, `valuation_model`, `market`, `calculations`, `affordability`, `valuation_agent`, `strategist` or `policy_gate` |
| `failureReason` | string or null | Why, in words an underwriter can read. Never contains a key |
| `agents` | map | `affordability`, `valuation`, `strategist` and `market`; see below |
| `creditMemo` | string | The strategist's memo. Named `creditMemo` because the audit record reads it by that name (a run without it cannot be minted) and its text is hashed |
| `originalRecommendation` | string | The strategist's own: `Approve`, `Conditionally Approve` or `Decline` |
| `effectiveRecommendation` | string | The one after the policy gate, same values. It can only be less favourable than the original |
| `consensus` | map | `votes` (the three voting agents side by side: `affordability`, `valuation`, `strategist`, each a recommendation) and `disagreement` (true when they do not all give the same one). There is no majority rule |
| `policyGate` | map | What the policy gate returned for this run, the same map as `review/underwriting.policyGate` (see there). Both are written in one batch, so a run record always keeps what the gate said, even after a re-run replaces the review document's copy |

`agents.<name>` always holds `provider`, `model`, `promptVersion` and `report` (the text the agent wrote). The three voting agents also hold `recommendation` (its vote), `rating` (`affordability`: `strong`, `adequate`, `weak` or `unaffordable`; `valuation`: `strong`, `adequate`, `weak` or `unsupported`), `concerns` and `conditions` (lists of text). A field an agent's reply does not have is null: the strategist has no `rating` and no `concerns`. Market & Macro does not vote, so its `recommendation`, `rating`, `concerns` and `conditions` are all null.

An older run record may still carry a single `recommendation` field (`approve`, `conditional` or `decline`). It is replaced by `originalRecommendation` and `effectiveRecommendation`, and the portal should read those and `consensus`.

## ai_calls/{callId} (Nic to confirm)

| Field | Type | Notes |
|---|---|---|
| `runId` | string | |
| `applicationId` | string | |
| `brokerId` | string | Copied for the rules |
| `agent` | string | For example `affordability`, `valuation`, `market`, `strategist` |
| `provider` | string | For example `gemini`, `mistral`, `groq`, `ollama` |
| `model` | string | |
| `output` | string | The agent's recommendation and reasoning |
| `latencyMs` | number | |
| `createdAt` | timestamp | |

## support_requests/{requestId} (proposal, from the API design doc's endpoints)

Who reads it: the user who sent it, underwriters. Written by al-core (`POST /core/support-requests`).

| Field | Type | Notes |
|---|---|---|
| `userId` | string | uid of the sender |
| `subject` | string | |
| `message` | string | |
| `status` | string | `open` or `closed` |
| `createdAt` | timestamp | |

## reviews/{uid} (proposal, from the API design doc's endpoints)

One per user, so `PUT /core/reviews/me` can replace it. Who reads it: that user, underwriters. Written by al-core.

| Field | Type | Notes |
|---|---|---|
| `userId` | string | Same as the document ID |
| `rating` | number | 1 to 5 |
| `comment` | string | Optional |
| `updatedAt` | timestamp | |

## users/{uid}/saved_checks/{checkId}

A property check the borrower ran and kept. Who reads it: only that user, directly from Firestore, so there is no list endpoint. Written by al-core only (`POST` and `DELETE /core/saved-checks`), never by a client. A borrower keeps at most 20; the 21st is refused with `409`. Every save is its own snapshot, with no de-duplication.

The client sends the valuation result it already has and the API validates and stores it; it does not call al-ai again. The API body is snake_case with the application's property names, so picking a check fills the application's `property` with no renaming.

| Field | Type | Notes |
|---|---|---|
| `property` | map | `county`, `eircode` (the full Eircode), `propertyType`, `bedrooms`, `floorAreaSqm`, `berRating`, and `askingPriceEur` when one was given. The same names and limits as the application's property map, so a saved check can always fill an application. No address lines: a saved check is about the kind of home, not a particular one. The full Eircode is stored because re-running the check and filling the application need it |
| `estimatedValueEur` | number | From `POST /ai/valuation` |
| `askingPriceGap` | number | Asking price / estimate - 1. Null without an asking price |
| `priceNeedsReview` | boolean | The valuation's flag, shown as Fair or Over-priced. Null without an asking price |
| `supportWarnings` | array | Plain-English reasons the estimate is less reliable. Empty when there are none |
| `modelVersion` | string | The valuation model's version, for example `v2` |
| `createdAt` | timestamp | Set by the API |

## Open questions

1. **ai_runs and ai_calls fields:** Nic to confirm or replace.
2. **Loan terms for HELOC:** resolved. A HELOC uses `loanAmountEur` for the credit limit plus `existingMortgageBalanceEur`, and its LTV is the combined LTV.
3. **Stress-test results:** stored, or calculated on demand by `/ai/portfolio/*`?
4. **Custom feature:** extra fields once the team chooses it.
5. **Risk tier rule:** resolved on AL-64, see below.
6. **LTV basis:** resolved on AL-64 for the band and tier: the LTV against the asking price for a mortgage and against the valuation estimate for a HELOC (it has no asking price). `ltvPct` stays the valuation-based figure.

## Risk tier rule

Worked out by al-ai from the stressed values after each committee run (and again on a re-run). The bands are al-ai's affordability labels: `Comfortable`, `Caution` or `Adverse`. The committee's vote is never an input. Count one concern for each of:

1. the stressed DTI is in the Caution band
2. the surplus is in the Caution band
3. that LTV (the one the band uses) is over 80%
4. the price is flagged "price needs review", or the model support is low

Then, checking D first:

| Tier | When |
|---|---|
| D | Any Adverse band, or a Central Bank cap breach: the loan over 4x gross income for a first-time buyer, 3.5x otherwise, or the LTV over 90%. A HELOC always uses 3.5x and counts the existing mortgage plus the new loan, the same total its combined LTV uses |
| C | 2 or more concerns |
| B | Exactly 1 concern |
| A | No concerns |

`scripts/seed.js` has the same rule (`riskTier`) and `test/risk-tier.test.js` tests it.

**Worked examples.** The same cases are in `test/risk-tier-examples.json`, which `test/risk-tier.test.js` checks; al-ai can load the file to test its version against the same answers.

| Case | Application | Findings | Tier | Why |
|---|---|---|---|---|
| No concerns | FTB mortgage €270,000, income €75,000, price €337,500 | DTI Comfortable, surplus Comfortable | **A** | 80% LTV, 3.6x income, both bands Comfortable |
| Stressed DTI in Caution | FTB mortgage €270,000, income €75,000, price €337,500 | DTI Caution, surplus Comfortable | **B** | 1 concern |
| LTV over 80% | FTB mortgage €270,000, income €75,000, price €320,000 | DTI Comfortable, surplus Comfortable | **B** | 84.4% LTV: 1 concern |
| Price needs review | FTB mortgage €270,000, income €75,000, price €337,500 | DTI Comfortable, surplus Comfortable, price needs review | **B** | 1 concern |
| Price needs review and low model support | FTB mortgage €270,000, income €75,000, price €337,500 | DTI Comfortable, surplus Comfortable, price needs review, low model support | **B** | the same concern, counted once |
| DTI and surplus both in Caution | FTB mortgage €270,000, income €75,000, price €337,500 | DTI Caution, surplus Caution | **C** | 2 concerns |
| Four concerns | FTB mortgage €270,000, income €75,000, price €320,000 | DTI Caution, surplus Caution, price needs review | **C** | 4 concerns is still C, never D |
| Surplus Adverse | FTB mortgage €270,000, income €75,000, price €337,500 | DTI Comfortable, surplus Adverse | **D** | any Adverse band |
| LTV over 90% | FTB mortgage €270,000, income €75,000, price €295,000 | DTI Comfortable, surplus Comfortable | **D** | 91.5% LTV: Central Bank cap |
| LTV exactly 90% | FTB mortgage €270,000, income €75,000, price €300,000 | DTI Comfortable, surplus Comfortable | **B** | 90% is not over the cap, but it is over 80% |
| First-time buyer over 4x income | FTB mortgage €300,001, income €75,000, price €400,000 | DTI Comfortable, surplus Comfortable | **D** | 300,001 > 4 x 75,000 |
| Second-time buyer exactly 3.5x income | non-FTB mortgage €262,500, income €75,000, price €400,000 | DTI Comfortable, surplus Comfortable | **A** | 262,500 = 3.5 x 75,000: not over |
| HELOC over 3.5x counting the existing mortgage | HELOC €40,000 + €250,000 existing, income €80,000, home value €500,000 | DTI Comfortable, surplus Comfortable | **D** | 40,000 + 250,000 = 290,000 > 280,000 |
| HELOC exactly 3.5x counting the existing mortgage | HELOC €40,000 + €240,000 existing, income €80,000, home value €500,000 | DTI Comfortable, surplus Comfortable | **A** | 40,000 + 240,000 = 280,000; 56% combined LTV |

