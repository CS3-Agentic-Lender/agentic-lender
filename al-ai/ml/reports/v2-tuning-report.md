# v2 tuning on the 80% training rows

Scored on the 4,882 development rows in the same five group folds; calibration rows were training rows only and the final test was not read. Rules are in `v2_tuning_config.json`, committed before this ran.

## Winner: ensemble_mean

ensemble_mean is the simplest of 1 contender(s) within 0.0 point(s) of the best (ensemble_mean, 20.33%).

## Did tuning beat the v1 settings?

A tuned model replaces the v1 settings if it has a lower CV MAPE.

| Model | v1 settings CV MAPE % | Best of the trials % | Gain | Settings used |
|---|---|---|---|---|
| hist_gradient_boosting | 21.35 | 21.05 | 0.30 | tuned |
| catboost | 21.38 | 20.68 | 0.70 | tuned |
| mlp | 22.40 | 21.33 | 1.06 | tuned |

## All contenders (with the settings used)

| Contender | CV MAPE % | MdAPE % | Within 10% | Average miss | R² | Median over/under | Fold spread |
|---|---|---|---|---|---|---|---|
| hist_gradient_boosting | 21.05 | 14.53 | 36.2 | €110,522 | 0.718 | +0.4% | 0.75 |
| catboost | 20.68 | 13.99 | 38.3 | €108,588 | 0.715 | +0.4% | 0.86 |
| mlp | 21.33 | 14.72 | 36.7 | €109,979 | 0.734 | +1.0% | 1.21 |
| ensemble_mean | 20.33 | 13.75 | 38.4 | €106,382 | 0.733 | +0.6% | 0.86 |

Each tuned figure is the best of its trials scored on the same folds that chose it, so it is slightly optimistic. The final test gives the honest figure.
