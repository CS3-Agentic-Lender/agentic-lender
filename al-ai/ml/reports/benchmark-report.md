# Baseline and candidate model benchmark

Development partition only (60% of the kept rows). Calibration and the final test were not read. The target is the 2024 **asking** price, so these figures say how well asking prices can be predicted, not true value.

## Setup

- Seed 42, shares [0.6, 0.2, 0.2], 5 group-aware folds shared by every model.
- 10,081 kept rows split into 6,047 development, 2,020 calibration and 2,014 test. Counties missing from a partition: none.
- Complete-input benchmark: 4,882 development rows with a known floor area. Price bands are the development quartiles (€270,000, €385,000, €550,000).
- Inputs: county, property type, bedrooms, floor area, BER. The model learns log(price) and is scored in euro.
- Python 3.12.3, numpy 2.5.4, pandas 3.0.6, scikit-learn 1.9.1, xgboost 3.4.1, catboost 1.2.10.
- Metrics fingerprint `079e19738c03b2b5` (all metrics, no timings): identical on a re-run with the same inputs (rounded to 6 decimals).

## Leaderboard

Ranked by CV MAPE (mean of the five fold MAPEs). Fold spread is the standard deviation across folds, which is not a significance test. The other columns pool every out-of-fold prediction.

| Rank | Model | CV MAPE % | Fold spread | MdAPE % | Within 10% | MAE € | R² | Fit s/fold | Predict ms/1,000 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | catboost | 26.31 | 1.39 | 18.59 | 28.6 | 135,195 | 0.618 | 0.7 | 6.9 |
| 2 | hist_gradient_boosting | 26.78 | 1.35 | 18.94 | 27.7 | 136,862 | 0.605 | 0.2 | 7.3 |
| 3 | mlp | 27.18 | 1.39 | 19.23 | 27.7 | 138,341 | 0.605 | 2.7 | 6.6 |
| 4 | xgboost | 27.84 | 1.90 | 19.03 | 27.0 | 142,029 | 0.575 | 0.1 | 7.9 |
| 5 | random_forest | 28.14 | 1.74 | 19.90 | 27.3 | 140,973 | 0.604 | 0.2 | 30.5 |
| 6 | ridge | 31.02 | 3.04 | 21.07 | 25.2 | 155,725 | 0.502 | 0.0 | 6.3 |
| 7 | knn | 31.70 | 2.09 | 21.71 | 25.6 | 152,281 | 0.567 | 0.0 | 16.8 |
| 8 | baseline | 31.90 | 2.61 | 20.71 | 25.6 | 148,165 | 0.607 | 0.0 | 2.3 |

The baseline fell back to the county median for 19 of 4,882 predictions (0.4%) and to the global median for 0.

## Where the best model (catboost) is weak

### By property type

| Segment | Rows | MAPE % | MdAPE % | Within 10% | MAE € |
|---|---|---|---|---|---|
| Apartment | 673 | 22.55 | 18.13 | 29.3 | 82,019 |
| Bungalow | 341 | 27.96 | 20.09 | 27.9 | 93,130 |
| Detached | 1,923 | 29.47 | 20.21 | 27.8 | 189,804 |
| Duplex | 64 | 22.86 | 19.38 | 25.0 | 85,391 |
| End of Terrace | 258 | 26.54 | 18.48 | 27.5 | 107,999 |
| Semi-D | 915 | 21.21 | 15.68 | 32.6 | 102,830 |
| Terrace | 659 | 26.47 | 18.52 | 26.7 | 115,009 |
| Townhouse | 49 | 38.72 | 25.09 | 16.3 | 99,240 |

### By price band

| Segment | Rows | MAPE % | MdAPE % | Within 10% | MAE € |
|---|---|---|---|---|---|
| Q1 cheapest quarter | 1,261 | 37.04 | 21.63 | 25.1 | 63,264 |
| Q2 | 1,219 | 20.13 | 14.51 | 35.9 | 64,849 |
| Q3 | 1,203 | 20.09 | 15.72 | 33.7 | 93,375 |
| Q4 dearest quarter | 1,199 | 27.53 | 23.92 | 19.7 | 324,322 |
| top decile (90th percentile and up) | 490 | 32.03 | 31.18 | 15.7 | 550,825 |

### By county

| Segment | Rows | MAPE % | MdAPE % | Within 10% | MAE € |
|---|---|---|---|---|---|
| Carlow | 39 | 16.62 | 13.74 | 38.5 | 69,190 |
| Cavan | 65 | 29.27 | 17.58 | 27.7 | 76,620 |
| Clare | 117 | 28.70 | 19.09 | 31.6 | 89,606 |
| Cork | 659 | 28.79 | 19.15 | 28.2 | 127,818 |
| Donegal | 184 | 30.31 | 18.34 | 29.3 | 89,222 |
| Dublin | 1,529 | 25.03 | 19.94 | 23.9 | 190,519 |
| Galway | 249 | 33.02 | 22.51 | 20.5 | 139,989 |
| Kerry | 141 | 31.30 | 20.10 | 19.1 | 111,005 |
| Kildare | 163 | 20.53 | 14.81 | 36.8 | 131,214 |
| Kilkenny | 97 | 25.11 | 20.21 | 24.7 | 133,951 |
| Laois | 76 | 22.42 | 12.95 | 44.7 | 73,793 |
| Leitrim | 48 | 24.47 | 13.60 | 37.5 | 43,742 |
| Limerick | 109 | 32.71 | 24.31 | 25.7 | 101,318 |
| Longford | 43 | 19.05 | 8.85 | 53.5 | 37,087 |
| Louth | 100 | 16.20 | 12.09 | 45.0 | 74,679 |
| Mayo | 181 | 35.86 | 25.21 | 24.3 | 93,464 |
| Meath | 116 | 21.08 | 13.77 | 38.8 | 172,389 |
| Monaghan | 32 | 17.57 | 11.04 | 46.9 | 43,795 |
| Offaly | 56 | 20.74 | 15.28 | 35.7 | 81,506 |
| Roscommon | 103 | 35.92 | 23.45 | 22.3 | 67,013 |
| Sligo | 67 | 22.45 | 16.69 | 34.3 | 70,413 |
| Tipperary | 112 | 24.94 | 16.72 | 31.2 | 90,566 |
| Waterford | 92 | 19.57 | 13.76 | 33.7 | 83,626 |
| Westmeath | 55 | 29.20 | 13.74 | 38.2 | 111,533 |
| Wexford | 249 | 16.83 | 11.13 | 44.6 | 70,537 |
| Wicklow | 200 | 30.79 | 24.56 | 21.5 | 205,828 |

## The baseline, for comparison

### By property type

| Segment | Rows | MAPE % | MdAPE % | Within 10% | MAE € |
|---|---|---|---|---|---|
| Apartment | 673 | 25.52 | 19.66 | 26.7 | 88,157 |
| Bungalow | 341 | 32.38 | 22.84 | 25.8 | 104,868 |
| Detached | 1,923 | 35.16 | 22.83 | 24.2 | 199,461 |
| Duplex | 64 | 20.34 | 18.74 | 31.2 | 79,923 |
| End of Terrace | 258 | 36.08 | 22.20 | 22.5 | 141,016 |
| Semi-D | 915 | 26.22 | 16.51 | 30.2 | 115,785 |
| Terrace | 659 | 34.74 | 23.07 | 22.5 | 139,250 |
| Townhouse | 49 | 49.33 | 25.20 | 28.6 | 111,875 |

### By price band

| Segment | Rows | MAPE % | MdAPE % | Within 10% | MAE € |
|---|---|---|---|---|---|
| Q1 cheapest quarter | 1,261 | 48.91 | 24.34 | 22.7 | 82,080 |
| Q2 | 1,219 | 26.40 | 18.95 | 27.4 | 84,679 |
| Q3 | 1,203 | 23.75 | 17.81 | 30.9 | 110,069 |
| Q4 dearest quarter | 1,199 | 27.77 | 23.17 | 21.4 | 320,436 |
| top decile (90th percentile and up) | 490 | 30.42 | 29.16 | 17.3 | 527,986 |
