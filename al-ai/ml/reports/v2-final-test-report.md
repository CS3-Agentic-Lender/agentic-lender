# v2 final test (scored once)

The frozen v2 model (average of hist_gradient_boosting, catboost, mlp) was fitted once on the development and calibration rows with a floor area. The threshold and the price range were set from out-of-fold predictions on the 4,882 development rows and written to `v2-threshold.json` before the 1,630 final test rows were predicted. Rows without a floor area (384) cannot be predicted, because the app always sends an area.

| | v2 | v1 (same test rows) | Baseline |
|---|---|---|---|
| MAPE | **21.31%** | 26.97% | 31.93% |
| MdAPE | 13.56% | 19.19% | 21.01% |
| Within 10% | 38.8% | 27.9% | 25.6% |
| MAE | €116,471 | €139,327 | €153,713 |
| R² | 0.674 | 0.624 | 0.542 |

Development CV for v2 was 20.33%; the final test is 21.31% (+0.98 points). The test MAPE is within 2 points of the development figure, so the development scores held up.

## Price needs review and the price range

Threshold **35.7%** (90th percentile of asking / estimate - 1 on the out-of-fold development predictions). The flag fired on **9.7%** of the test rows (development: 10.0%). The 80% price range held **80.4%** of the asking prices (development: 80.0%).

| Gap percentile | Final test | Development (out-of-fold) |
|---|---|---|
| p5 | -37.7% | -34.8% |
| p10 | -26.3% | -25.5% |
| p25 | -13.6% | -12.9% |
| p50 | -1.2% | -0.6% |
| p75 | 13.1% | 14.3% |
| p90 | 33.9% | 35.7% |
| p95 | 54.8% | 56.8% |

## Nothing changes after this

The model, features, threshold and range are frozen. Rerunning `v2_final.py` is refused while this report exists.
