"""The frozen v2 valuation model as one object: the equal-weight average, in log-price, of its member pipelines.

Each member is the same pipeline the tuning scored (Eircode routing key features, log-price target). The average of
log-prices is the geometric mean of the euro estimates. Lives in its own module so a saved file can be loaded by anything
that can import `ml`, and never depends on a script's `__main__`.
"""

import numpy as np

from ml import benchmark as b
from ml import experiments as ex

KEY = ["eircode_routing_key"]
# What the pipeline reads from one property: the five app inputs plus the Eircode routing key (first three characters).
INPUT_COLUMNS = b.FEATURE_COLUMNS + ["rkey"]


class LogMeanEnsemble:
    def __init__(self, members: dict):
        self.members = dict(members)

    def fit(self, X, y):
        for member in self.members.values():
            member.fit(X, y)
        return self

    def predict(self, X) -> np.ndarray:
        return np.exp(np.mean([np.log(m.predict(X)) for m in self.members.values()], axis=0))


def settings(params: dict) -> dict:
    """JSON lists back to the tuples scikit-learn expects (hidden_layer_sizes)."""
    return {k: tuple(v) if isinstance(v, list) else v for k, v in params.items()}


def build(frozen: dict, seed: int) -> LogMeanEnsemble:
    """An unfitted model from the frozen v2 file: its members, their chosen settings, the Eircode routing key features."""
    if frozen["winner"] != "ensemble_mean":
        raise NotImplementedError(f"v2_model builds the frozen ensemble, not {frozen['winner']}")
    return LogMeanEnsemble({m: b.make_model(m, seed, settings(frozen["params"][m]), features=ex.FeatureBuilderV2(KEY)) for m in frozen["members"]})
