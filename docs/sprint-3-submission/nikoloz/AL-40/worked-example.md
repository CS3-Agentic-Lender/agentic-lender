# AL-40 worked example: one application at +200 bps

Acceptance criterion 4 of AL-40 says the rate shock figures come from the backend calculation and that one application's numbers match a hand-checked example. This page works one application through by hand and compares it with what al-ai returns.

## The application

`app-deliberated` from the seed (`al-core/scripts/seed.js`). It is AI Deliberated, so it is one of the active applications the rate shock covers. Its committee run stored a benchmark rate of 4.00% (`review/underwriting.dtiBreakdown.benchmarkRatePct`, the seed's default `aprPct`), so the rate shock uses that stored rate (`rate_source: "stored"`).

| Input | Stored field | Value |
|---|---|---|
| Loan | `loanAmountEur` | €265,000 |
| Term | `termYears` | 30 years (360 months) |
| Gross income | `grossIncomeEur` | €75,000 a year |
| Take-home pay | `monthlyTakeHomeEur` | €4,300 a month |
| Existing debts | `monthlyDebtsEur` | €1,000 a month |
| Living costs | `monthlyLivingCostsEur` | €1,200 a month |
| Benchmark rate | `dtiBreakdown.benchmarkRatePct` | 4.00% |
| Shock | request `shock_bps` | 200 bps = +2.00 points |

## The rules being checked

From `al-ai/app/affordability.py` and `al-ai/app/rate_shock.py`:

- Monthly repayment (annuity): `P × r / (1 − (1 + r)^−n)`, where `r` is the annual rate divided by 12 and `n` is the number of months.
- Debt to income (DTI): `(existing debts + repayment) / (gross income / 12)`.
- Monthly surplus: `take-home − living costs − existing debts − repayment`.
- DTI band: up to 40% Comfortable, up to 50% Caution, above that Adverse.
- Surplus band: €500 or more Comfortable, €0 or more Caution, below €0 Adverse.
- The application's band is the worse of its DTI band and its surplus band.
- "Before" is the benchmark rate. "After" is the benchmark rate plus the shock.

## By hand

Each step below was worked one operation at a time on a calculator (PowerShell's `[math]` functions), not by calling the backend code. Figures are shown to more places than needed and rounded only at the end.

Gross monthly income is 75,000 / 12 = **€6,250.00**.

### Before: 4.00%

| Step | Working | Result |
|---|---|---|
| Monthly rate `r` | 0.04 / 12 | 0.0033333333 |
| `(1 + r)^360` | 1.0033333333^360 | 3.3134980146 |
| `(1 + r)^−360` | 1 / 3.3134980146 | 0.3017958652 |
| `1 − (1 + r)^−360` | 1 − 0.3017958652 | 0.6982041348 |
| Repayment per euro | 0.0033333333 / 0.6982041348 | 0.0047741530 |
| Monthly repayment | 265,000 × 0.0047741530 | **€1,265.15** (1,265.1505) |
| DTI | (1,000 + 1,265.1505) / 6,250 = 2,265.1505 / 6,250 | **36.24%** (0.3624241) |
| Surplus | 4,300 − 1,200 − 1,000 − 1,265.1505 | **€834.85** (834.8495) |
| DTI band | 36.24% is not above 40% | Comfortable |
| Surplus band | €834.85 is at least €500 | Comfortable |
| Band | worse of the two | **Comfortable** |

### After: 4.00% + 2.00 points = 6.00%

| Step | Working | Result |
|---|---|---|
| Monthly rate `r` | 0.06 / 12 | 0.005 |
| `(1 + r)^360` | 1.005^360 | 6.0225752123 |
| `(1 + r)^−360` | 1 / 6.0225752123 | 0.1660419280 |
| `1 − (1 + r)^−360` | 1 − 0.1660419280 | 0.8339580720 |
| Repayment per euro | 0.005 / 0.8339580720 | 0.0059955053 |
| Monthly repayment | 265,000 × 0.0059955053 | **€1,588.81** (1,588.8089) |
| DTI | (1,000 + 1,588.8089) / 6,250 = 2,588.8089 / 6,250 | **41.42%** (0.4142094) |
| Surplus | 4,300 − 1,200 − 1,000 − 1,588.8089 | **€511.19** (511.1911) |
| DTI band | 41.42% is above 40% but not above 50% | Caution |
| Surplus band | €511.19 is at least €500 | Comfortable |
| Band | worse of the two | **Caution** |

So the shock adds €323.66 a month to the repayment, raises the DTI by 5.18 points and takes the application across the 40% limit: it moves from Comfortable into Caution.

## The backend on the same inputs

`app/rate_shock.py` and `app/affordability.py` import only the Python standard library, so the real `rate_shock.run` function can be called directly, with no service, sign-in or Firestore. This is the function `POST /ai/portfolio/rate-shock` calls once it has loaded the applications.

Command, run from `al-ai/` in the `feature/AL-40-band-chart-and-worked-example` worktree (al-ai as on `main` at ebcfa88):

```powershell
py -3 -I -c "import sys, json; sys.path.insert(0, '.'); from app import rate_shock; loan = rate_shock.Loan(application_id='app-deliberated', loan_eur=265000, term_years=30, gross_income_eur=75000, take_home_monthly_eur=4300, debts_monthly_eur=1000, living_costs_monthly_eur=1200, benchmark_rate_pct=4.0, rate_source='stored'); print(json.dumps(rate_shock.run([loan], 200), indent=2))"
```

Output:

```json
{
  "shock_bps": 200,
  "applications": [
    {
      "application_id": "app-deliberated",
      "rate_source": "stored",
      "benchmark_rate_pct": 4.0,
      "shocked_rate_pct": 6.0,
      "before": {
        "repayment_eur": 1265.15,
        "dti": 0.3624,
        "surplus_eur": 834.85,
        "band": "Comfortable"
      },
      "after": {
        "repayment_eur": 1588.81,
        "dti": 0.4142,
        "surplus_eur": 511.19,
        "band": "Caution"
      },
      "moved_into": "Caution"
    }
  ],
  "totals": {
    "count": 1,
    "before": {
      "Comfortable": { "count": 1, "share_pct": 100.0 },
      "Caution": { "count": 0, "share_pct": 0.0 },
      "Adverse": { "count": 0, "share_pct": 0.0 }
    },
    "after": {
      "Comfortable": { "count": 0, "share_pct": 0.0 },
      "Caution": { "count": 1, "share_pct": 100.0 },
      "Adverse": { "count": 0, "share_pct": 0.0 }
    },
    "moved_into_caution": 1,
    "moved_into_adverse": 0
  },
  "skipped": []
}
```

(The `totals` block is printed one band per line here to save space; the values are as printed.)

al-ai sends DTI as a fraction rounded to four places, so 0.3624 is 36.24%; the portal multiplies by 100 once, in `services/stressService.ts`.

## Comparison

| Figure | By hand | Backend | Match |
|---|---|---|---|
| Rate before / after | 4.00% / 6.00% | 4.0 / 6.0 | Yes |
| Repayment before | €1,265.15 | 1265.15 | Yes, to the cent |
| Repayment after | €1,588.81 | 1588.81 | Yes, to the cent |
| DTI before | 36.24% | 0.3624 | Yes, to 0.01 point |
| DTI after | 41.42% | 0.4142 | Yes, to 0.01 point |
| Surplus before | €834.85 | 834.85 | Yes, to the cent |
| Surplus after | €511.19 | 511.19 | Yes, to the cent |
| Band before | Comfortable | Comfortable | Yes |
| Band after | Caution | Caution | Yes |
| Moved into | Caution | Caution | Yes |

Every figure matches: the money to the cent and the DTI to 0.01 of a point. In the portal this application is one of the applications counted in the "Affordability bands, before and after" card, moving from the Comfortable count to the Caution count at +200 bps.
