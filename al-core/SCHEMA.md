# al-core: Firestore schema

Version 0.1 (draft for team confirmation). Follows the API design doc (AL-199).

## Rules that apply everywhere

- **Clients only read Firestore.** Every write goes through al-core or al-ai using the Admin SDK. The Firestore rules deny all client writes.
- **Field names are camelCase in Firestore.** The APIs use snake_case and convert between the two (`fullName` here is `full_name` in the API).
- **Money** is a euro amount (never cents) in a field ending `Eur`, for example `loanAmountEur`. The API name ends `_eur`.
- **Percentages** are numbers in a field ending `Pct`, where `4.0` means 4%. The API name ends `_pct`.
- **Timestamps** are Firestore timestamps. The API sends them as ISO 8601 UTC strings.
- **IDs** are strings.

## Collections

| Path | Who reads it | Written by | Holds |
|---|---|---|---|
| `users/{uid}` | That user, underwriters | al-core (`POST /core/me`) | Profile and chosen broker |
| `applications/{id}` | The borrower, the assigned broker, underwriters | al-core, al-ai | Status, loan terms, results, decision, loan note |
| `applications/{id}/review/underwriting` | The assigned broker, underwriters | al-ai | Risk tier, DTI breakdown, valuation detail |
| `applications/{id}/audit/record` | The assigned broker, underwriters | al-core (at mint) | The record behind the on-chain audit hash |
| `applications/{id}/messages/{messageId}` | The borrower, the assigned broker, underwriters | al-core | The message thread |
| `ai_runs/{runId}` | The assigned broker, underwriters | al-ai | One record per committee run |
| `ai_calls/{callId}` | The assigned broker, underwriters | al-ai | One record per AI call |

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
| `brokerId` | string | no | Borrowers only: uid of the chosen broker (AL-142) |
| `createdAt` | timestamp | yes | Server timestamp |

## applications/{id}

### People and status

| Field | Type | Required | Notes |
|---|---|---|---|
| `borrowerId` | string | yes | uid of the borrower |
| `brokerId` | string | yes | uid of the assigned broker. Copied from the borrower's profile when the application is created |
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
| `depositEur` | number | mortgage only | |
| `firstTimeBuyer` | boolean | mortgage only | Sets the income multiple (4x first-time, 3.5x otherwise) |
| `loanAmountEur` | number | yes | Amount requested |
| `termYears` | number | yes | |
| `property` | map | yes | See below |

`property` map:

| Field | Type | Notes |
|---|---|---|
| `county` | string | From `GET /ai/valuation/options` |
| `propertyType` | string | From `GET /ai/valuation/options` |
| `bedrooms` | number | |
| `floorAreaSqm` | number | |
| `berRating` | string | From `GET /ai/valuation/options` |
| `askingPriceEur` | number | Optional |

### Results and decision

| Field | Type | Required | Notes |
|---|---|---|---|
| `estimatedValueEur` | number | no | From `POST /ai/valuation` |
| `ltvPct` | number | no | Loan to value |
| `dtiPct` | number | no | Debt to income |
| `aprPct` | number | no | Rate offered |
| `approvalLikelihoodPct` | number | no | From the AI committee |
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
| `riskTier` | string | `A`, `B`, `C` or `D` |
| `dtiBreakdown` | map | `incomeMonthlyEur`, `existingDebtsMonthlyEur`, `newRepaymentMonthlyEur` |
| `valuationDetail` | map | `baselineEur`, `contributions` (feature name to euro effect), `estimatedValueEur` |
| `updatedAt` | timestamp | |

## applications/{id}/audit/record

Written once at mint. Declined applications have none. The audit hash is the SHA-256 of this record serialised with `json.dumps(record, sort_keys=True, separators=(",", ":"))`.

| Field | Type | Notes |
|---|---|---|
| `applicationId` | string | |
| `decision` | string | |
| `riskTier` | string | |
| `creditMemo` | string | |
| `underwriterId` | string | |
| `signedOffAt` | string | ISO 8601 UTC, so the hash is reproducible |
| `aiCalls` | array | Each item: `id` and `sha256` of that `ai_calls` document |
| `auditHash` | string | The SHA-256 stored on chain |

## applications/{id}/messages/{messageId}

| Field | Type | Notes |
|---|---|---|
| `senderId` | string | uid |
| `senderRole` | string | `borrower`, `broker` or `underwriter` |
| `text` | string | |
| `sentAt` | timestamp | |

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

## Open questions

1. **ai_runs and ai_calls fields:** Nic to confirm or replace.
2. **Loan terms for HELOC:** does a HELOC need different fields (credit limit, draw period) from a mortgage?
3. **Stress-test results:** stored, or calculated on demand by `/ai/portfolio/*`?
4. **Custom feature:** extra fields once the team chooses it.
