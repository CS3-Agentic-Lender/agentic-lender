# Calibration threshold and final test

The frozen model (hist_gradient_boosting) was fitted once on the development split (4,882 rows with a floor area, 0.6 s). The threshold was set on the calibration split (1,637 rows) and written to `threshold.json` before the final test split (1,630 rows) was predicted. The final test was scored once. Rows with no floor area (384 in the test split) cannot be predicted, because the app always sends an area.

## The threshold

Signed gap `g = asking price / estimate - 1` (unrounded estimate), threshold `t = max(0, 90th percentile of g)` = **43.3%**, from 1,637 calibration properties (quantile method: linear). At inference, `asking / estimate - 1 > t` means **price needs review**. Equality does not trigger it, and an asking price below the estimate is never a flag.

## The final test (scored once)

| | Frozen model | Baseline (reference) |
|---|---|---|
| MAPE | **26.97%** | 31.93% |
| MdAPE | 19.19% | 21.01% |
| Within 10% | 27.9% | 25.6% |
| MAE | €139,327 | €153,713 |
| R² | 0.624 | 0.542 |

On the development folds the same model scored 26.72% CV MAPE. The final test is the figure that was never chosen on, so it is the honest one. This measures how well asking prices are predicted within a 2024 listing sample, nothing more.

## Price needs review

The flag fired on **10.6%** of the test properties (calibration: 10.0%, about 10% by construction). This is a heuristic from historical asking-price gaps, not proof that a property is overpriced and not a guaranteed 10% rate in the future.

| Gap percentile | Final test | Calibration |
|---|---|---|
| p5 | -41.6% | -42.2% |
| p10 | -32.5% | -31.6% |
| p25 | -18.0% | -18.2% |
| p50 | -1.9% | -1.0% |
| p75 | 20.9% | 19.2% |
| p90 | 46.0% | 43.3% |
| p95 | 70.1% | 70.5% |

## Weakest segments (final test)

Counties with at least 20 test rows, worst MAPE first. Price bands are the development quartiles.

| County | Rows | MAPE % | MdAPE % | Within 10% |
|---|---|---|---|---|
| Tipperary | 38 | 40.3 | 20.5 | 31.6 |
| Cavan | 24 | 38.9 | 32.0 | 16.7 |
| Kerry | 46 | 37.3 | 24.3 | 21.7 |
| Galway | 83 | 35.0 | 25.5 | 19.3 |
| Donegal | 56 | 32.9 | 21.3 | 23.2 |

| Property type | Rows | MAPE % | MdAPE % | Within 10% |
|---|---|---|---|---|
| Apartment | 197 | 21.0 | 15.2 | 34.0 |
| Bungalow | 113 | 28.1 | 19.1 | 28.3 |
| Detached | 631 | 32.6 | 21.1 | 25.5 |
| Duplex | 15 | 22.1 | 26.7 | 33.3 |
| End of Terrace | 98 | 25.0 | 18.6 | 23.5 |
| Semi-D | 341 | 21.7 | 16.6 | 30.8 |
| Terrace | 219 | 25.5 | 21.6 | 25.1 |
| Townhouse | 16 | 21.2 | 22.5 | 37.5 |

| Price band | Rows | MAPE % | MdAPE % | Within 10% |
|---|---|---|---|---|
| Q1 cheapest quarter | 430 | 37.0 | 22.4 | 24.2 |
| Q2 | 419 | 21.7 | 14.9 | 37.9 |
| Q3 | 360 | 21.4 | 17.9 | 27.5 |
| Q4 dearest quarter | 421 | 26.8 | 23.0 | 21.9 |
| top decile (90th percentile and up) | 163 | 30.4 | 26.8 | 16.6 |

## Nothing changes after this

The model, its features and the threshold are frozen. Rerunning this script is refused while this report exists. A different model or threshold would be a new version with its own evaluation.
