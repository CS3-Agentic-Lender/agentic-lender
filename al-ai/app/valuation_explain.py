"""Exact Shapley contributions in euro: how much each input added to or took off one estimate.

For a home x and a fixed background of 100 homes, the value of a set S of inputs is the model's average answer when the
inputs in S take x's values and the others take the background's values, one background home at a time. Averaged over
every order in which inputs could be revealed, each input's step is its Shapley value. Six inputs mean 2^6 = 64 sets, so
the answer is exact, and baseline + contributions equals the model's estimate for x.

The estimate comes from app.valuation_model. This module only asks the loaded model more questions.
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from math import factorial

import numpy as np
import pandas as pd

from app import valuation_model
from ml import data_readiness as dr

MAX_INPUTS = 10  # the number of sets doubles with every input: 10 inputs is already 1,024
CHUNK_ROWS = 200_000  # rows sent to the model in one go, so a long list of homes never builds one giant table


@dataclass(frozen=True)
class Explanation:
    estimate: float
    baseline: float  # the model's average answer over the background homes
    contributions: dict[str, float]  # euro per input; baseline + sum(contributions) = estimate


@dataclass(frozen=True)
class Explanations:
    baseline: float
    contributions: pd.DataFrame  # one row per home, one column per input


@lru_cache(maxsize=1)
def background() -> pd.DataFrame:
    """The fixed background sample saved with the model: 100 training homes, inputs only."""
    valuation_model._load()  # the manifest is only trusted once the model file has been checked against it
    manifest = json.loads((valuation_model.MODEL_DIR / "manifest.json").read_text())
    sample = pd.read_csv(valuation_model.MODEL_DIR / manifest["background_sample"]["file"])[manifest["input_columns"]]
    return sample.astype(object).where(sample.notna(), None)  # a missing routing key is None, as in a live request


def shapley_many(model, columns: list[str], homes: pd.DataFrame, background: pd.DataFrame) -> Explanations:
    """Exact Shapley values for every row of `homes`, in the model's own output unit (euro)."""
    n = len(columns)
    if n > MAX_INPUTS:
        raise ValueError(f"exact Shapley values need 2^{n} sets; more than {MAX_INPUTS} inputs is refused")
    sets = 1 << n
    bg = background[columns].reset_index(drop=True)
    size = len(bg)
    # bit j of the set number says whether input j takes the home's value (1) or the background's (0)
    takes_home = ((np.arange(sets)[:, None] >> np.arange(n)) & 1).astype(bool)
    per_chunk = max(1, CHUNK_ROWS // (sets * size))
    values = np.empty((len(homes), sets))
    for start in range(0, len(homes), per_chunk):
        part = homes[columns].iloc[start:start + per_chunk]
        frame = {}
        for j, col in enumerate(columns):
            home_col = part[col].to_numpy()[:, None, None]
            bg_col = bg[col].to_numpy()[None, None, :]
            frame[col] = np.where(takes_home[None, :, j, None], home_col, bg_col).ravel()
        predicted = np.asarray(model.predict(pd.DataFrame(frame)), float)
        values[start:start + len(part)] = predicted.reshape(len(part), sets, size).mean(axis=2)
    contributions = np.empty((len(homes), n))
    for i in range(n):
        without = np.array([s for s in range(sets) if not s >> i & 1])
        weight = np.array([factorial(bin(s).count("1")) * factorial(n - bin(s).count("1") - 1) / factorial(n) for s in without])
        contributions[:, i] = (values[:, without | (1 << i)] - values[:, without]) @ weight
    return Explanations(baseline=float(values[0, 0]) if len(homes) else float("nan"),
                        contributions=pd.DataFrame(contributions, index=homes.index, columns=columns))


def shapley(model, columns: list[str], home: dict, background: pd.DataFrame) -> Explanation:
    """Exact Shapley values for one home."""
    row = pd.DataFrame([home])
    out = shapley_many(model, columns, row, background)
    return Explanation(
        estimate=float(model.predict(row[columns])[0]),
        baseline=out.baseline,
        contributions={c: float(v) for c, v in out.contributions.iloc[0].items()},
    )


def explain_value(county: str, property_type: str, bedrooms: int, floor_area_m2: float, ber: str, routing_key: str | None = None) -> Explanation:
    """The saved model's estimate for one home, split into one euro contribution per input."""
    model, columns = valuation_model._load()
    # the same row estimate_value builds, so the two always describe the same home
    home = {"county": county, "property_type": property_type, "bedrooms": bedrooms, "floor_area_m2": floor_area_m2,
            "ber": dr.ber_band(ber), "rkey": routing_key.upper() if routing_key else None}
    try:
        return shapley(model, columns, home, background())
    except Exception as exc:
        raise valuation_model.ValuationUnavailable(f"the valuation could not be explained: {type(exc).__name__}") from exc
