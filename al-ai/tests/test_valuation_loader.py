"""The loader that serves the saved valuation model: it checks the file first and never guesses."""

import json
import shutil

import pytest

from app import valuation_model as vm


@pytest.fixture(autouse=True)
def fresh_cache():
    vm._load.cache_clear()
    yield
    vm._load.cache_clear()


def copy_of_the_package(tmp_path):
    target = tmp_path / "valuation"
    shutil.copytree(vm.MODEL_DIR, target)
    return target


def test_the_real_model_values_a_home():
    value = vm.estimate_value("Cork", "Semi-D", 3, 110, "B3")
    assert 100_000 < value < 1_000_000


def test_old_and_new_ber_scales_give_the_same_value():
    assert vm.estimate_value("Cork", "Semi-D", 3, 110, "B3") == vm.estimate_value("Cork", "Semi-D", 3, 110, "B")


def test_the_routing_key_changes_the_value_and_a_missing_one_still_works():
    with_key = vm.estimate_value("Dublin", "Terrace", 3, 100, "C1", "D14")
    without = vm.estimate_value("Dublin", "Terrace", 3, 100, "C1")
    assert with_key != without and with_key > 0 and without > 0
    assert vm.estimate_value("Dublin", "Terrace", 3, 100, "C1", "d14") == with_key  # case does not matter


def test_a_model_file_that_does_not_match_its_sha256_is_never_loaded(tmp_path, monkeypatch):
    pkg = copy_of_the_package(tmp_path)
    with open(pkg / "valuation-v2.joblib", "ab") as f:
        f.write(b"x")  # one extra byte
    loaded = []
    monkeypatch.setattr(vm.joblib, "load", lambda path: loaded.append(path))
    with pytest.raises(vm.ValuationUnavailable, match="SHA-256"):
        vm._load(pkg)
    assert loaded == []  # the pickle was not opened


def test_a_missing_model_is_unavailable_not_a_crash(tmp_path):
    with pytest.raises(vm.ValuationUnavailable):
        vm._load(tmp_path / "nothing-here")


def test_a_manifest_with_a_wrong_hash_is_refused(tmp_path):
    pkg = copy_of_the_package(tmp_path)
    manifest = json.loads((pkg / "manifest.json").read_text())
    manifest["sha256"] = "0" * 64
    (pkg / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(vm.ValuationUnavailable):
        vm._load(pkg)


def test_a_model_that_returns_nonsense_is_unavailable(monkeypatch):
    class Broken:
        def predict(self, X):
            return [float("nan")]

    monkeypatch.setattr(vm, "_load", lambda: (Broken(), ["county", "property_type", "bedrooms", "floor_area_m2", "ber", "rkey"]))
    with pytest.raises(vm.ValuationUnavailable):
        vm.estimate_value("Cork", "Semi-D", 3, 110, "B3")
