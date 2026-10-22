# Model card: property valuation v2

Ticket AL-121 (save the inference pipeline and write the model card), under the valuation model story AL-24. Owner: Nic (al-ai).

## What it is

A regression model that estimates the **2024 asking price** of an Irish home from the five things the application form already collects, plus the Eircode routing key. It also supplies an 80% price range and a "price needs review" flag (below). It estimates what sellers ask, not what homes sell for, and says nothing about later years.

- **Model:** the equal-weight average, in log price (the geometric mean of the euro estimates), of three pipelines: hist_gradient_boosting, catboost, mlp, each with the settings chosen by tuning (`ml/reports/v2-frozen-model.json`).
- **Target transform:** each pipeline predicts log(price) and converts back to euro with exp. The inverse transform is inside the saved file.
- **File:** `models/valuation/valuation-v2.joblib`, 1.31 MB, SHA-256 `624fb55f2d9a415689786fbb071a635bf81fceb01b0dc293c72f1c05e5810209`. This is exactly the file that was evaluated on the final test; it was not refitted afterwards.
- **Seed:** 42.

## Inputs

The saved file takes one row per home with exactly these columns:

| Column | Meaning | Allowed values |
|---|---|---|
| `county` | Republic of Ireland county | Carlow, Cavan, Clare, Cork, Donegal, Dublin, Galway, Kerry, Kildare, Kilkenny, Laois, Leitrim, Limerick, Longford, Louth, Mayo, Meath, Monaghan, Offaly, Roscommon, Sligo, Tipperary, Waterford, Westmeath, Wexford, Wicklow |
| `property_type` | Type of home | Detached, Semi-D, Terrace, End of Terrace, Bungalow, Apartment, Duplex, Townhouse |
| `bedrooms` | Number of bedrooms | whole number |
| `floor_area_m2` | Floor area | 15 to 1,000 m² (outside this the model was never shown data) |
| `ber` | Energy rating band | A to G, or `Unknown`. Old subgrades (A1 to E3) must be turned into their band first with `ml.data_readiness.ber_band`; anything unrecognised becomes `Unknown` |
| `rkey` | Eircode routing key, the first three characters (for example `D14`), from the application form's Eircode | one of 117 keys seen often enough in training, otherwise `Other`; missing is `Unknown` |

Routing keys the model knows (117): A63, A67, A81, A82, A84, A85, A91, A92, A94, A96, A98, C15, D01, D02, D03, D04, D05, D06, D07, D08, D09, D10, D11, D12, D13, D14, D15, D16, D17, D18, D20, D22, D24, D6W, E21, E32, E34, E41, E45, E53, E91, F12, F23, F26, F28, F31, F35, F42, F45, F52, F91, F92, F93, F94, H12, H14, H18, H53, H54, H65, H71, H91, K32, K34, K36, K45, K56, K67, K78, N37, N39, N41, N91, P12, P17, P24, P25, P31, P36, P43, P47, P51, P56, P61, P72, P75, P81, P85, R14, R32, R35, R42, R45, R93, R95, T12, T23, T45, V14, V15, V31, V35, V42, V92, V93, V94, V95, W12, W23, W91, X35, X91, Y14, Y21, Y25, Y34, Y35.

## Data

- **Source:** Daft.ie Ireland House Properties 2024 (Kaggle `adnankhalid007/ireland-house-properties-dataset-2024`), file `daft_housing_data.csv`, SHA-256 `d4c1ea0be20fa1b6b4720dcdea92fb8bda22b209efc4174689ff319f4d40ec4c`. The raw file is not in git.
- **Rows:** 14,289 in the file, 10,081 kept after the rules in `ml/reports/data-readiness.md` (every dropped row has one recorded reason), 8,149 of them with a floor area. The application always sends an area, so only those rows are used.
- **Split:** 60% development / 20% calibration / 20% final test, by property group so repeat adverts never cross. Of the rows with an area: development 4,882, calibration 1,637, final test 1,630.
- **Trained on:** the development and calibration rows (6,519). The final test was never used for training, tuning or choosing the threshold.
- **Eircode routing key:** read from the end of each listing title for training (found for about 95% of rows).

## How it was chosen and tested

Seven models and a baseline were compared on five group folds inside the development split; the three best were tuned with 50 random trials each and averaged. Every rule (what counts as a win, how ties break, what to report) was committed before the run it governs (`ml/*_config.json`). The final test was scored once, with a lock file that stops a second run. Full report with figures: `ml/reports/v2-model-report.md`.

## Metrics (final test, once)

1,630 homes the model never saw.

| Metric | v2 | v1 | Baseline (median price per m²) |
|---|---|---|---|
| MAPE (average miss) | **21.31%** | 26.97% | 31.93% |
| MdAPE (typical miss) | 13.56% | 19.19% | 21.01% |
| Within 10% of the asking price | 38.8% | 27.9% | 25.6% |
| MAE | €116,471 | €139,327 | €153,713 |
| R² | 0.674 | 0.624 | 0.542 |

RMSE €335,389; Spearman 0.887; AUC for "asking price above the median / top quarter / top tenth" 0.936 / 0.943 / 0.960. Development CV MAPE was 20.33%.

## "Price needs review" and the price range

- **Gap:** `g = asking price / estimate − 1`, from the unrounded estimate.
- **Threshold:** **35.7%**. The flag fires when `g` is strictly above it. It is the 90th percentile (numpy linear method) of `g` on the 4,882 development rows, predicted out-of-fold: each home by a model that never saw it. It is **not** set on the calibration rows, because the v2 model trains on them and the gaps there would be too small. On the final test it flagged 9.7% of homes (development 10.0%).
- **80% price range:** the estimate times (1 + the 10th percentile gap) to (1 + the 90th percentile gap), by estimate band, from the same out-of-fold predictions. It held 80.4% of final-test asking prices.

| Estimate band | Gap range (low to high) |
|---|---|
| estimate under €273k | -29% to 39% |
| €273k to €378k | -22% to 29% |
| €378k to €539k | -22% to 32% |
| estimate over €539k | -29% to 44% |

The flag is a heuristic from historical asking-price gaps. It is not proof that a home is overpriced.

## Background sample

`background-sample.csv`: 100 training homes drawn with seed 42, **inputs only** (no price, title, address or coordinates; floor area rounded to 5 m²). It is the fixed background for the explanation work later.

## Check that a reload gives the same answers

`reference-predictions.json` holds 52 made-up homes (not listings) and the saved model's predictions for them. A reload must reproduce them within a relative tolerance of 1e-06 (the same machine gives exactly 0). `tests/test_valuation_model.py` does this check and also checks the file's SHA-256 against `manifest.json`.

## Loading it

```python
import joblib
model = joblib.load('models/valuation/valuation-v2.joblib')   # check the SHA-256 in manifest.json first
model.predict(inputs_dataframe)                                # euro estimates, one per row
```

The file is a pickle (joblib). **Only load it from this repository after checking its SHA-256.** It must be loaded with the versions below; other versions may refuse to load or predict slightly differently.

| Package | Version it was saved with |
|---|---|
| python | 3.12.14 |
| scikit-learn | 1.9.1 |
| numpy | 2.5.4 |
| pandas | 3.0.6 |
| scipy | 1.18.1 |
| catboost | 1.2.10 |
| joblib | 1.6.0 |

## Limits

- **2024 asking prices, not sale prices.** It says nothing about 2027. When it values a home for a home equity line of credit, the value is an indicative 2024 asking-price estimate, not a valuation report or a sale price. The model is not retrained for this.
- **Typical error is real:** an average miss of 21% and a typical miss of 14%. Show the estimate with its range, never alone.
- **Weaker for the cheapest homes and in some rural counties** (the county table is in the report); the application should say estimates may be off depending on the county.
- **Biased high a little:** the median estimate is about 1% above the asking price, more for the dearest tenth of estimates.
- **Odd listings exist in the data** (a 209 m² detached house asking €80,000); no input can explain them.
- **Unusual homes** (area over 300 m², 8 or more bedrooms, a county or routing key with little training data) are outside what the test sample can vouch for.
- **The routing key** is required for the full accuracy; with it missing the model falls back on the other inputs.

## Where things are

- Report and figures: `ml/reports/v2-model-report.md`, `ml/reports/figures-v2-final/`
- Rules committed before each run: `ml/v2_tuning_config.json`, `ml/v2_final_config.json`
- Results: `ml/reports/v2-final-test-results.json`, `v2-threshold.json`, `v2-tuning-results.json`
- Rebuild this folder: `python ml/v2_final.py` (once, locked) then `python ml/v2_package.py`
