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
- Every row is accounted for, the split keeps repeat adverts together, and the benchmark is re-runnable: each machine reproduces itself exactly (the PC gave fingerprint `079e19738c03b2b5` twice, the Mac `8f5de9280e5a1ec5` twice) and the split is byte-identical on both.
- The full benchmark ran on the PC server with `prun` in under two minutes. The Mac and the PC differ by at most 0.01 points in two models (Random Forest 28.13 vs 28.14, kNN 31.69 vs 31.70), which is floating-point difference between the two chips and operating systems, not a different result. The tables here are the PC run.

**What went wrong, and what we did**
- **The first baseline scored 187% MAPE.** A handful of rows had floor areas like 0.05 (land in acres typed as a house) or 1,821,087 m². I checked the extremes before comparing models, as the plan says, and we agreed a plausible window of 15 to 1,000 m². The rule looks at area only, never price, so genuine expensive homes (up to 929 m², €10.75m) stay. The baseline then scored 31.9%.
- **A gap in the tests.** Breaking the grouping code on purpose (ignoring coordinates) did not make any test fail, so a missing test was added. Two weak assertions that could never fail were also replaced with real checks.
- **The re-run test failed at first.** Multi-threaded models differ in the 13th decimal place between runs, so the fingerprint now rounds to 6 decimals. That is stated in the report rather than hidden.
- **The PC server lost its internet** while it needed to install xgboost and catboost (the home network was down), so the first full run used the Mac with identical library versions. When the network came back the PC run worked first time.

## Tuning and the frozen winner

Before any tuning ran, the rules were committed in `tuning_config.json`: a model must beat the baseline by 2 points of CV MAPE, the shortlist is the top three (CatBoost, HistGradientBoosting, MLP), each gets 50 seeded random trials on the same five folds, and anything within 1 point of the best is tied and goes to the simplest (HistGradientBoosting, then CatBoost, then MLP, then the ensemble). You also suggested averaging the best models instead of picking one, so an equal-weight average of the three tuned models was added as a fourth contender. That is a change to the written plan, and it has to beat the best single model by more than a point to win.

| Model | Defaults | Tuned | Gain |
|---|---|---|---|
| CatBoost | 26.31% | 26.14% | 0.17 |
| HistGradientBoosting | 26.78% | 26.72% | 0.06 |
| MLP | 27.18% | 26.76% | 0.43 |
| Ensemble of the three tuned | - | **25.92%** | - |
| Baseline | 31.90% | - | - |

150 trials (750 model fits) took 15 minutes on the PC.

**Result: HistGradientBoosting is frozen as the winner.** Tuning barely moved anything (0.06 to 0.43 points), and the ensemble, the best score at 25.92%, is only 0.2 to 0.8 points ahead of the three single models. That is inside the 1-point tie band, so by the rule we fixed beforehand the simplest tied model wins: HistGradientBoosting is built into scikit-learn (no extra library in the app), predicts one model's worth rather than three, and its fold spread (1.18) is among the lowest of the four (the MLP's is 1.14). It beats the baseline by 5.2 points, well over the 2-point margin.

**What this means**
- The ensemble would have won with a clear gap of over a point, but it didn't, and I did not move the line afterwards. That is the point of writing the rules first.
- The ensemble's 0.2 to 0.8 point gain is real but small, and it would cost three models in the app and CatBoost as a dependency.
- Tuning showed we are near the limit of what these five inputs can predict: noise in asking prices, not the choice of model, is what is left.
- The tuned scores are slightly optimistic, because each is the best of 50 trials chosen on the same folds. The final test is the honest figure.

## Limits

- Target is the 2024 asking price, not a sale price.
- The 20 to 30% error means this is an indicative estimate, and the app and the Valuation agent must present it that way.
- Floor-area rows with no area (19%) are excluded from this benchmark. Imputing them is an optional experiment in the plan.
- Related units in one building can still sit in different folds, since groups are matched on title and coordinates.

## Next

1. Use the calibration data for the price-review threshold and score the final test once (AL-120).
2. Save the pipeline and write the model card (AL-121).
