# Tuning and freezing the winner

Development data only (4,882 rows with a floor area, the same five group folds as the benchmark). Calibration and the final test were not read. The margin, tie rule, shortlist and search spaces were committed in `tuning_config.json` before any tuning ran.

## Decision

**Winner: hist_gradient_boosting.** hist_gradient_boosting is the simplest of 4 contender(s) within 1.0 point(s) of the best (ensemble_mean, 25.92%).

Rules (fixed beforehand): a model must beat the baseline (31.90% CV MAPE) by 2.0 points; anything within 1.0 point of the best is tied and the simplest wins, in the order hist_gradient_boosting < catboost < mlp < ensemble_mean.

## Default versus tuned

| Model | Defaults CV MAPE % | Tuned CV MAPE % | Gain (points) | Fold spread | MdAPE % | Within 10% | MAE € | Trials | Compute |
|---|---|---|---|---|---|---|---|---|---|
| catboost | 26.31 | 26.14 | 0.17 | 1.40 | 18.77 | 28.9 | 135,476 | 50 | 140 s |
| hist_gradient_boosting | 26.78 | 26.72 | 0.06 | 1.18 | 19.20 | 27.6 | 137,026 | 50 | 174 s |
| mlp | 27.18 | 26.76 | 0.43 | 1.14 | 19.03 | 27.7 | 137,686 | 50 | 599 s |
| ensemble_mean (equal average of the three tuned) | - | 25.92 | - | 1.21 | 18.61 | 28.9 | 133,969 | - | - |
| baseline | 31.90 | - | - | 2.61 | 20.71 | 25.6 | 148,165 | - | - |

150 trials ran in total (750 model fits) in 15.2 minutes of compute. A random search with this budget is not a guarantee of the best settings.

**A caution on the tuned numbers.** Each tuned model is the best of its 50 trials, scored on the same folds that chose it, so its CV MAPE is slightly optimistic. The final test, which no trial has touched, gives the honest figure.

## Best settings found

- **catboost** (trial 41): `{"depth": 8, "learning_rate": 0.035164154688396405, "iterations": 508, "l2_leaf_reg": 1.2752078781684326}`
- **hist_gradient_boosting** (trial 10): `{"learning_rate": 0.039774374789764005, "max_iter": 448, "max_leaf_nodes": 23, "min_samples_leaf": 22, "l2_regularization": 1.9977634480318898}`
- **mlp** (trial 45): `{"hidden_layer_sizes": [64], "alpha": 0.023123007592704102, "learning_rate_init": 0.0008578960869699426}`

## The ensemble

An equal-weight average of the three tuned models' predictions in log-price, taken from their out-of-fold predictions (nothing fitted). It is an addition to the written plan, which lists seven single models. It ships three models instead of one and needs CatBoost in the app, so it only wins by beating the best single model by more than 1.0 point.
