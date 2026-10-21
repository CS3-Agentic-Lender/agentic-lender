"""The saved valuation model: load it once, check it is the file that was evaluated, and value one home.

The model file is a pickle, and loading a pickle runs code, so the file's SHA-256 is checked against
models/valuation/manifest.json first. A file that does not match is never loaded. The model needs the `ml` package
(it was saved from classes in it) and the package versions pinned in pyproject.toml.
"""

import hashlib
import json
from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd

from ml import data_readiness as dr

MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "valuation"


class ValuationUnavailable(Exception):
    """The model could not be loaded safely. The caller answers 503; a value is never guessed."""


@lru_cache(maxsize=1)
def _load(model_dir: Path = MODEL_DIR):
    try:
        manifest = json.loads((model_dir / "manifest.json").read_text())
        path = model_dir / manifest["model_file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["sha256"]:
            raise ValuationUnavailable("the valuation model file does not match its recorded SHA-256")
        return joblib.load(path), manifest["input_columns"]  # a pickle, loaded only after the check above
    except ValuationUnavailable:
        raise
    except Exception as exc:  # missing file, wrong package versions, corrupt file
        raise ValuationUnavailable(f"the valuation model could not be loaded: {type(exc).__name__}") from exc


def estimate_value(county: str, property_type: str, bedrooms: int, floor_area_m2: float, ber: str, routing_key: str | None = None) -> float:
    """The model's estimate of the asking price in euro. Old BER subgrades (A1 to E3) become their A to G band; anything else is Unknown."""
    model, columns = _load()
    row = {"county": county, "property_type": property_type, "bedrooms": bedrooms, "floor_area_m2": floor_area_m2,
           "ber": dr.ber_band(ber), "rkey": routing_key.upper() if routing_key else None}
    try:
        value = float(model.predict(pd.DataFrame([row])[columns])[0])
    except Exception as exc:
        raise ValuationUnavailable(f"the valuation model could not value this home: {type(exc).__name__}") from exc
    if not value > 0 or value == float("inf"):
        raise ValuationUnavailable("the valuation model returned an unusable value")
    return value
