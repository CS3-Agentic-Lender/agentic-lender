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
| `loanType` | string | yes | `mortgage` or `heloc` |
| `createdAt` | timestamp | yes | |
| `submittedAt` | timestamp | no | Set when the status moves from `Draft` to `Applied` |
| `updatedAt` | timestamp | yes | |

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
| `termYears` | number | yes | |
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
| `ltvPct` | number | no | Loan to value: (loanAmountEur / estimatedValueEur) * 100 for a mortgage, and (existingMortgageBalanceEur + loanAmountEur) / estimatedValueEur * 100 (combined LTV) for a HELOC. Whether to use the lower of the valuation and the asking price is an open question |
| `dtiPct` | number | no | Debt to income at the benchmark rate, to one decimal place. The stressed figure and every other part are in `review/underwriting.dtiBreakdown` |
| `aprPct` | number | no | Rate offered. Until pricing exists it is the benchmark rate used (`dtiBreakdown.benchmarkRatePct`) |
| `approvalLikelihoodPct` | number | no | From the AI committee |
| `ltvBand` | string | no | `80_or_less`, `80_to_90` (over 80 up to 90) or `over_90`, from the LTV the underwriter judges the loan on: against the asking price for a mortgage (`loanAmountEur / property.askingPriceEur`), and against the valuation estimate for a HELOC (`(existingMortgageBalanceEur + loanAmountEur) / estimatedValueEur`, because a HELOC has no asking price). Set by al-ai with the tier. The underwriter's queue filters on it with `status` |
| `riskTier` | string | no | `A`, `B`, `C` or `D`, by the risk tier rule below. Set by al-ai after each run, with the same value as in `review/underwriting`. Here so the queue can filter on it with `status`; the borrower can read it, like `ltvPct` |
| `decision` | map | no | Set by the underwriter. See below |
| `loanNote` | map | no | Set at mint. See below |
| `feeStatus` | string | no | `unpaid` or `paid` (EUR 150 appraisal fee) |
| `feeIntentId` | string | no | Stripe payment intent id |

`decision` map: `outcome` (`approved` or `declined`), `underwriterId`, `decidedAt`, `reason` (optional).

`loanNote` map: `tokenId`, `contractAddress`, `txHash`, `auditHash`, `mintedAt`. No personal data goes on chain.

## applications/{id}/review/underwriting

Underwriter-only details, kept in a separate document so borrowers can't read them.

| Field | Type | Notes |
|---|---|---|
| `applicationId` | string | The parent application's id |
| `brokerId` | string | Copied from the application, so a collection-group query and its rule can check broker access |
| `riskTier` | string | `A`, `B`, `C` or `D` |
| `dtiBreakdown` | map | Every part of the debt-to-income calculation, at the benchmark rate and at the stressed rate. See below |
| `valuationDetail` | map | `baselineEur`, `contributions` (feature name to euro effect), `estimatedValueEur` |
| `updatedAt` | timestamp | |

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
| `read` | boolean | Whether the recipient has read it. Set through POST /core/applications/{id}/messages/read |

## ai_runs/{runId} (Nic to confirm)

| Field | Type | Notes |
|---|---|---|
| `applicationId` | string | |
| `brokerId` | string | Copied from the application so the rules can check broker access |
| `status` | string | `running`, `failed` or `complete` |
| `trigger` | string | `submit` or `rerun` |
| `startedAt` | timestamp | |
| `finishedAt` | timestamp | |
| `recommendation` | string | For example `approve`, `conditional`, `decline` |
| `approvalLikelihoodPct` | number | |
| `creditMemo` | string | From the Underwriting Strategist |

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

## users/{uid}/saved_checks/{checkId} (proposal, from the API design doc's endpoints)

A borrower's saved property checks. Who reads it: that user. Written by al-core (`POST` and `DELETE /core/saved-checks`).

| Field | Type | Notes |
|---|---|---|
| `property` | map | Same shape as the application's property map, without the address fields (`addressLine1`, `addressLine2`, `eircode`): a saved check is about the kind of home, not a particular one |
| `estimatedValueEur` | number | From `POST /ai/valuation` |
| `createdAt` | timestamp | |

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

