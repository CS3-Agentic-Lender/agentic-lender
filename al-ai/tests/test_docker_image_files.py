"""The Docker image must hold every file the running service reads. `uv run pytest` runs outside Docker, so a file left out by
.dockerignore only shows up once the image is running (the breakdown was silently missing there)."""

import fnmatch
import json
from pathlib import Path

import pytest

from app import valuation_model

AL_AI = Path(__file__).resolve().parents[1]


def ignore_patterns() -> list[str]:
    lines = (AL_AI / ".dockerignore").read_text().splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def is_ignored(relative_path: str) -> bool:
    """True if a .dockerignore pattern matches the path or any folder above it. Negations ("!x") are not used in this file."""
    parts = relative_path.split("/")
    prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    return any(fnmatch.fnmatch(prefix, pattern) for pattern in ignore_patterns() for prefix in prefixes)


def runtime_model_files() -> list[str]:
    manifest = json.loads((valuation_model.MODEL_DIR / "manifest.json").read_text())
    names = ["manifest.json", manifest["model_file"], manifest["background_sample"]["file"]]
    return [f"models/valuation/{name}" for name in names]


@pytest.mark.parametrize("path", runtime_model_files())
def test_every_file_the_service_reads_at_run_time_is_in_the_image(path):
    assert (AL_AI / path).exists(), f"{path} is missing from the repo"
    assert not is_ignored(path), f"{path} is listed in .dockerignore so the running service cannot find it"


def test_the_checker_does_flag_a_file_that_is_ignored():
    assert is_ignored("tests/test_x.py") and is_ignored("data/raw/daft.csv") and is_ignored("ml/reports/x.md")
    assert not is_ignored("models/valuation/valuation-v2.joblib")


def test_the_dockerfile_copies_the_models_folder_and_the_app():
    dockerfile = (AL_AI / "Dockerfile").read_text()
    assert "COPY models ./models" in dockerfile and "COPY app ./app" in dockerfile
