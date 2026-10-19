# The valuation model: what we built, what we found, what we decided

Status on 19 Oct 2026. This is the record of the work, so nothing depends on anyone remembering it. Numbers come from the reports in `reports/`; the reasons are in the decision log below. Nic owns this part and is interviewed on it, so this file explains the choices as well as the results.

## 1. What it is

A model that predicts the **2024 asking price** of an Irish house from five things the app can ask for: county, floor area (m²), bedrooms, property type and BER. It is trained on the Daft.ie 2024 listings (Kaggle: `adnankhalid007/ireland-house-properties-dataset-2024`). It estimates what sellers ask, not what houses sell for, and says nothing about 2027.

**Where it stands**
- **v1 is frozen**: HistGradientBoosting on the five inputs. Final test: **26.97% MAPE** (typical miss about 19%, 28% of estimates within 10%), against 31.93% for the simple baseline.
- **v2 is proposed, not built**: adding the **Eircode routing key** (first three characters of the Eircode, which the application form already collects) cut development-fold error from 26.7% to 22.2%. It needs Ibrahima's agreement and its own tuning and final test.
- **Not done yet**: saving the model with a model card, and the `/ai/valuation` endpoint.

## 2. How the code fits together (run in this order)

| Step | File | What it does | Output |
|---|---|---|---|
| 1 | `data_readiness.py` | Keeps or drops every row of the CSV for exactly one reason, records the file's SHA-256 | `reports/data-readiness.md` |
| 2 | `split.py` + `benchmark.py` | 60/20/20 split by property group, county-balanced; baseline and 7 models on 5 shared folds | `reports/benchmark-report.md`, `split-manifest.json` |
| 3 | `tune.py` (rules in `tuning_config.json`) | 50 random trials each for the top 3, plus an equal-average ensemble; freezes the winner | `reports/tuning-report.md`, `frozen-model.json` |
| 4 | `final_eval.py` | Fits the winner on development, sets the "price needs review" threshold on calibration, scores the final test once | `reports/threshold.json`, `final-test-report.md` |
| 5 | `experiments.py` + `figures.py` (rules in `experiments_config.json`) | Tests extra inputs on the development folds and draws the figures | `reports/extra-inputs-report.md`, `reports/figures/` |

Tests are in `../tests/` (`test_data_readiness`, `test_split`, `test_benchmark`, `test_tune`, `test_final_eval`, `test_experiments`, `test_figures`). The ones needing numpy and scikit-learn skip themselves where those are not installed.

**Running it.** The heavy steps run on the Ubuntu PC server: `cd al-ai && prun --pull ml/reports ml/benchmark.py` (same for `tune.py`, `experiments.py`). The dataset lives in `/srv/data` on the PC and is mounted at `/data`; locally it is in `al-ai/data/raw/` (git-ignored). `extras.txt` (xgboost, catboost) must sit in the **project root** (`al-ai/`), not next to the script. Step 4 refuses to run twice.

## 3. The data

14,289 listings in, **10,081 kept**. Every row has one reason, in this order: exact duplicate 8; site (land) 2,713; Price on Application 548; "From" price 220; AMV guide price 141; sterling 1; missing price 24; Northern Ireland 53; missing or unknown county 248; property type not supported 25; **floor area outside 15 to 1,000 m² 227**.

- **Supported property types are the main eight**: Detached, Semi-D, Terrace, End of Terrace, Bungalow, Apartment, Duplex, Townhouse. "House", "Studio" and "Property" are too sparse; "Houses" and "New Homes" are development adverts with no usable price.
- **Floor area must be 15 to 1,000 m².** Areas like 0.05 are land in acres typed as houses, and 1,821,087 is a typo. The rule looks at area only, never price, so genuine expensive homes (929 m², €10.75m) stay.
- **BER** is coarsened to A to G bands. Ranges and codes (N/A, NA, SI_666, BER_PENDING) become Unknown, never a guessed grade.
- **Repeat adverts** of one property (same title and coordinates) share a group, so a property is never split across partitions or folds. 214 coordinate points carry more than one title (units in one building) and are treated as different properties, which leaves some leakage risk.
- **19.2% of kept rows have no floor area.** The benchmark uses the 8,149 complete rows because the app always sends an area.

## 4. Evaluation protocol

Seed 42. Development 60% (6,047 rows, 4,882 with an area), calibration 20% (2,020), final test 20% (2,014), whole property groups, balanced by county. Five group folds inside development, shared by every model. Calibration and the final test are read only by `final_eval.py`.

| Stage | Result |
|---|---|
| Benchmark, CV MAPE (defaults) | CatBoost 26.31, HistGradientBoosting 26.78, MLP 27.18, XGBoost 27.84, Random Forest 28.13, Ridge 31.02, kNN 31.69, baseline 31.90 |
| After tuning (50 trials each) | CatBoost 26.14, HGB 26.72, MLP 26.76, ensemble of the three 25.92 |
| Winner | **HistGradientBoosting** (all four within the 1-point tie band, so the simplest wins) |
| Final test (scored once) | **26.97% MAPE**, typical miss 19.2%, within 10% 27.9%, MAE €139,327, R² 0.624 (baseline 31.93%) |
| "Price needs review" threshold | 43.3% (90th percentile of asking/estimate − 1 on 1,637 calibration rows); fired on 10.6% of test properties |

Tuning gained only 0.06 to 0.43 points, and the final test (26.97%) was close to cross-validation (26.72%), so nothing overfitted. Accuracy is limited by the data, not the model.

## 5. The v2 finding (extra inputs)

On the development folds, with the frozen model and CatBoost as a check:

| Added input | App collects it? | HGB CV MAPE | CatBoost CV MAPE |
|---|---|---|---|
| (five inputs) | | 26.72% | 26.14% |
| **Eircode routing key** | **yes** | **22.23%** | **21.78%** |
| bathrooms | no | 26.41% | 25.81% |
| construction year | no | 26.19% | 25.68% |
| town (reference only) | no | 24.80% | 23.56% |
| coordinates (reference only) | no | 20.17% | 19.84% |

The Eircode key was found for 94.8% of rows (read from the end of the listing title). Within 10% goes from 27.6% to 34.5%, and the right price range (quartiles) from 60.6% to 67.4%. Better in all five folds for both models. See `reports/extra-inputs-report.md` and its figures. These are development-fold numbers, so slightly optimistic; a v2 gets its own final test.

## 6. Decision log

| Decision | Why |
|---|---|
| Main eight property types | Plan: don't merge rare types into different homes; the data decides, and it fixes the list Ibrahima's form needs. |
| Floor area 15 to 1,000 m² | The first baseline scored 187% MAPE because of junk areas. Decided before comparing models, as the plan says. |
| Improvement margin 2 points, tie band 1 point, ties go to the simplest | Written to `tuning_config.json` and committed **before** any tuning, so the winner could not be chosen after seeing numbers. |
| Add an equal-average ensemble | Suggested by Nic. A change to the written plan (seven single models). It must beat the best single model by over a point, because it ships three models and needs CatBoost. |
| HistGradientBoosting over the ensemble | Ensemble was best (25.92%) but only 0.2 to 0.8 points ahead, inside the tie band; HGB is built into scikit-learn and ships as one model. |
| Fit the shipped model on development only | "Ship exactly the evaluated artifact"; refitting on more data needs a new evaluation. |
| Final test scored once, with a lock | The script refuses to run while its report exists; the threshold cannot depend on the test split. |
| Propose the Eircode key, not bathrooms or build year | Rule fixed beforehand: 1 point for an input the app already collects, 2 for a new field, in both models and all five folds. |
| Recommendation takes the smallest set that passes | After seeing results: "Eircode + bathrooms" passed only because the Eircode does the work. Thresholds unchanged; the report says so. |
| Fold bars, not lines, in the figures | Folds have no order. Lines made the error look like it grew each fold, which is chance. |

## 7. How it went (what to remember)

- **Check the data before comparing models.** Junk floor areas gave a baseline of 187% MAPE and a Ridge R² of −5.8 until the area rule went in.
- **Write the rules first, then run.** The margin, tie rule and proposal rule were committed before any run each time. One rule (Eircode + bathrooms) still needed a fix after the results, and we said so openly.
- **Break your own code to test your tests.** Several tests passed with a deliberate bug in place (an equality case that was not exact in floating point, a grouping test that ignored coordinates). Each was fixed.
- **Reproducibility is per machine.** The same run reproduces exactly; the Mac and the PC differ by up to 0.01 points in two models (different chips, floating point). Fingerprints round to 6 decimals because multi-threaded models differ at the 13th decimal.
- **Confusion matrices are for classes.** For prices we use a price-range version (how often the model puts a house in the right quartile range), with real euro ranges.

## 8. Gotchas

- `ml/artifacts/` is git-ignored (a Hardhat rule for `artifacts/` folders). The fitted model is saved there by `final_eval.py` (SHA-256 `f5d938ca541c6aa6562fc07ce98dbc3e0b5f05ef8784d9d554d743dff56a1f39`); the model-saving ticket commits it to a folder that is not ignored.
- The PC lost its internet once (home network), which breaks `prun`'s package install. `ssh pc` over the private cable still works; `pc-lan` is the home-network route that `prun` and Docker use.
- The Daft CSV is not in git. Download it from Kaggle into `al-ai/data/raw/` and check the SHA-256 in `reports/data-readiness.md`.
- The Eircode routing key is read from listing titles for training; at inference it comes from the application form's Eircode field, which is required on submit.

## 9. What the refinement agents found (19 Oct)

Four agents explored refinements on the development folds only (the untouched 40% stayed untouched). Their reports are summarised here; the experiments that matter are in `reports/`.

| Avenue | Finding |
|---|---|
| **More data** | No other dataset is likely to help much: the Eircode key already captures "where", and even exact coordinates only reach about 20%. Best candidate is the Property Price Register as an area price level (probably under 1 point, and its addresses are personal data: never commit them). Traps: scraping Daft or MyHome, Eircode's paid address database, using the sale price of the same house. |
| **Other models** | LightGBM equals HistGradientBoosting. Random Forest, ExtraTrees and the MLP are worse. Blends of five models add 0.3 to 0.5 points, not worth shipping five models. |
| **Tuning and features** | Tuning alone gives 0.4 to 0.7 points. Other encodings of the Eircode key, log area, ratios, winsorising and imputing missing area give nothing reliable. |
| **Weighting by 1/price** | Lowers MAPE by 1.3 to 2 points, but only by making the model estimate about 4% low: typical miss and within-10% barely move, average miss in euro gets worse (€115,807 to €121,623) and R² falls from 0.68 to 0.56. A plain 0.95 shrink of the predictions gets most of the same MAPE gain. Not adopted: it optimises the metric, not the information. |
| **Expected price** (`reports/expected-price-followup.md`) | Log area plus the routing key's smoothed price per m2, learned from training data. Checked for leakage (tests, two planted leaks caught, a shuffled-price canary with no gain). Real but small: 22.23 to 21.60 (HGB) and 21.78 to 21.40 (CatBoost), better in all five folds, below the 1-point rule, so not adopted. |
| **Noise ceiling** | About 11% error looks unavoidable with these inputs (near-identical homes differ by about 14% in asking price). The gap from 11% to 22% is condition, exact location and seller whim. |
| **Where the errors are** | The worst 5% of homes carry 24% of the error (cheap rural, derelict, pubs, big areas at tiny prices). A cleaning rule does not really improve the model: dropping those homes from scoring "gains" 1.5 points, but retraining without them and scoring everything gains 0.1. |
| **Uncertainty** | Band-conformal prediction intervals reach 81% coverage for an 80% target at about plus or minus 31%. Show the app an estimate with a range, and a low-confidence warning for unusual homes (area over 300 m2, 8 or more bedrooms, cheapest range, missing Eircode). |
| **Review threshold** | A v2 model needs its own calibration: the development proxy is about 38% against v1's 43.3%. |

**Plan if the Eircode key is adopted:** v2 is five inputs plus the routing key, unweighted (about 22% CV MAPE), shown as an estimate with an 80% range. Tune it on log loss, calibrate its own review threshold, and score its own final test once. Everything beyond that is small or comes from estimating low.

## 10. Ideas still open

- **More data**: area-level context joined by routing key (Census, CSO price indices, rent data), the Property Price Register for sold prices, the SEAI BER database. Needs a feasibility and licence check.
- **More models and tricks**: LightGBM, ExtraTrees, stacking, a loss closer to MAPE, other target transforms, monotonic constraints.
- **Hyperparameters and features with the Eircode key**: bigger or Bayesian search with nested cross-validation, target encoding of the routing key, imputing missing floor area, interactions.
- **Noise ceiling and uncertainty**: how much of the error is irreducible (repeat adverts with different asking prices), and prediction intervals for the app.
- **Hard rule for all of the above**: development folds only. Calibration and the final test stay untouched until a v2 is frozen and scored once.
