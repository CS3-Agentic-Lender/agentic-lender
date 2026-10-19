# Valuation model: the data, the evaluation and how it went

Draft for Nic to read, correct and put in his own words. All numbers come from `data-readiness.md` and `benchmark-report.md` in this folder.

## What we set out to do

Predict a house's 2024 **asking price** from five things the app can ask for (county, floor area, bedrooms, property type, BER), and say honestly how accurate that is. We followed the valuation plan: clean the data with written rules, split it once by property, compare a simple baseline with seven models on the same five folds, and keep 40% of the data untouched until the model is frozen.

## The data

The Daft.ie 2024 file has 14,289 listings (checksum matches the plan's snapshot). Every row is kept or dropped for exactly one reason, so the report adds up:

| | Rows |
|---|---|
| Land sites, development adverts, "price on application", guide prices, sterling and missing prices | 3,655 |
| Northern Ireland, missing county, property types we don't support | 326 |
| Floor area outside 15 to 1,000 m² (quarantined) | 227 |
| **Kept** | **10,081** |

Of the kept rows, 19.2% have no floor area. The main benchmark uses the 8,149 that do, because the app always asks for the area.

**Decisions made along the way**
- **Supported property types are the main eight** (Detached, Semi-D, Terrace, End of Terrace, Bungalow, Apartment, Duplex, Townhouse). "House", "Studio" and "Property" have too few rows to learn from.
- **Floor area must be 15 to 1,000 m².** See "what went wrong" below.
- **BER** is coarsened to A to G bands, with ranges and codes like SI_666 as Unknown.
- **Repeat adverts** of one property (same title and coordinates) share a group, so a property can't be in both training and testing.

## The evaluation

Development data only: 6,047 rows split off (60%), 4,882 of them with a floor area, in five folds. Calibration (2,020 rows) and the final test (2,014 rows) were not read.

| Model | CV MAPE | Within 10% | Average miss (MAE) |
|---|---|---|---|
| CatBoost | **26.3%** | 28.6% | €135,195 |
| HistGradientBoosting | 26.8% | 27.7% | €136,862 |
| MLP | 27.2% | 27.7% | €138,341 |
| XGBoost | 27.8% | 27.0% | €142,029 |
| Random Forest | 28.1% | 27.4% | €140,762 |
| Ridge | 31.0% | 25.2% | €155,725 |
| kNN | 31.7% | 25.6% | €152,328 |
| **Baseline** (median €/m² by county and type) | 31.9% | 25.6% | €148,165 |

**What it says, honestly**
- The best models beat the baseline by about 5.6 percentage points of MAPE (26.3% vs 31.9%). That is a real but modest gain.
- The top three (CatBoost, HistGradientBoosting, MLP) are within one point of each other and the folds vary by about 1.4 points, so there is no clear winner yet. Tuning those three is the next step.
- Only about 3 in 10 predictions land within 10% of the asking price. Asking prices are noisy: sellers ask what they like, and the five inputs say nothing about condition, exact location or garden.
- The model is weakest on the cheapest quarter of homes (37% MAPE, because a small euro miss is a big percentage), the top 10% of prices (32% MAPE, 31% typical miss), townhouses (39%, but only 49 rows) and some counties such as Mayo, Galway and Limerick.
- This measures how well we predict asking prices in a 2024 sample. It says nothing about 2027 or about true value.

## How it went

**What went well**
- Every row is accounted for, the split keeps repeat adverts together, and the whole benchmark is re-runnable: a second full run gave the identical fingerprint (`8f5de9280e5a1ec5`) and a byte-identical split.
- The first five models also ran on the PC server and matched the Mac to within 0.02 points.

**What went wrong, and what we did**
- **The first baseline scored 187% MAPE.** A handful of rows had floor areas like 0.05 (land in acres typed as a house) or 1,821,087 m². I checked the extremes before comparing models, as the plan says, and we agreed a plausible window of 15 to 1,000 m². The rule looks at area only, never price, so genuine expensive homes (up to 929 m², €10.75m) stay. The baseline then scored 31.9%.
- **A gap in the tests.** Breaking the grouping code on purpose (ignoring coordinates) did not make any test fail, so a missing test was added. Two weak assertions that could never fail were also replaced with real checks.
- **The re-run test failed at first.** Multi-threaded models differ in the 13th decimal place between runs, so the fingerprint now rounds to 6 decimals. That is stated in the report rather than hidden.
- **The PC server had no internet** when it needed to install xgboost and catboost, so the full run used the Mac with identical library versions. The PC run of the full set is still to do.

## Limits

- Target is the 2024 asking price, not a sale price.
- The 20 to 30% error means this is an indicative estimate, and the app and the Valuation agent must present it that way.
- Floor-area rows with no area (19%) are excluded from this benchmark. Imputing them is an optional experiment in the plan.
- Related units in one building can still sit in different folds, since groups are matched on title and coordinates.

## Next

1. Tune the three best models on a fixed budget, with the improvement margin written down before any tuning, and freeze the winner (AL-119).
2. Use the calibration data for the price-review threshold and score the final test once (AL-120).
3. Save the pipeline and write the model card (AL-121).
