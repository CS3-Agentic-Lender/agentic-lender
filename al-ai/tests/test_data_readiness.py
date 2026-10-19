import csv
from pathlib import Path

import pytest

from ml import data_readiness as dr

COLUMNS = ["Title", "Price", "Number of Bedrooms", "Number of Bathrooms", "Property Type", "Floor Area (m2)",
           "BER Rating", "Latitude", "Longitude", "Listing Views", "Area", "County", "Features", "Date of Construction"]


def row(**over):
    base = {c: "NA" for c in COLUMNS}
    base.update(Title="1 Main St, Co. Cork", Price="300000", **{"Number of Bedrooms": "3"}, **{"Property Type": "Detached"},
                **{"Floor Area (m2)": "100"}, **{"BER Rating": "C2"}, Latitude="51.9", Longitude="-8.4", County="Cork")
    base.update({k.replace("_", " "): v for k, v in over.items()})
    return base


def why(**over):
    kept, dropped, _ = dr.classify([row(**over)])
    return None if kept else next(iter(dropped))


# ---- price semantics -----------------------------------------------------------------------

@pytest.mark.parametrize("price, reason", [
    ("Price on Application", "Price on Application"),
    ("AMV: Price on Application", "Price on Application"),
    ("From 420000", "From price (development advert)"),
    ("AMV: 250000", "AMV price (guide value)"),
    ("£200000 (232959)", "Sterling price"),
    ("N/A", "Missing price"),
    ("0", "Missing price"),
    ("about 300k", "Unrecognised price"),
])
def test_unusable_prices_are_dropped_with_their_reason(price, reason):
    assert why(Price=price) == reason


def test_a_plain_euro_price_is_kept_and_parsed():
    kept, _, _ = dr.classify([row(Price="499000")])
    assert kept[0]["price_eur"] == 499000


# ---- scope: homes in the Republic of Ireland of a supported type ---------------------------

def test_sites_are_dropped_even_with_a_good_price():
    assert why(Property_Type="Site") == "Site (land, not a home)"


@pytest.mark.parametrize("county", ["Antrim", "Down", "Fermanagh", "Derry", "Tyrone", "Armagh"])
def test_northern_ireland_is_dropped(county):
    assert why(County=county) == "Northern Ireland county"


@pytest.mark.parametrize("county", ["N/A", "", "Narnia"])
def test_missing_or_unknown_county_is_dropped(county):
    assert why(County=county) == "Missing or unknown county"


@pytest.mark.parametrize("ptype", ["Houses", "House", "Studio", "Property", "New Homes", "N/A"])
def test_unsupported_property_types_are_dropped(ptype):
    assert why(Property_Type=ptype) == "Property type not supported"


@pytest.mark.parametrize("ptype", dr.SUPPORTED_TYPES)
def test_the_main_eight_are_kept(ptype):
    assert why(Property_Type=ptype) is None


@pytest.mark.parametrize("area, kept", [("0", False), ("0.3", False), ("14.9", False), ("15", True), ("929", True),
                                        ("1000", True), ("1000.5", False), ("1821087", False)])
def test_floor_area_window_is_15_to_1000(area, kept):
    r = row()
    r["Floor Area (m2)"] = area
    assert (dr.classify([r])[0] != []) is kept


def test_a_quarantined_area_is_counted_under_its_own_reason():
    r = row()
    r["Floor Area (m2)"] = "0.3"
    assert dr.classify([r])[1]["Floor area outside 15 to 1,000 m2 (quarantined)"] == 1


def test_expensive_homes_are_kept_the_rule_never_looks_at_price():
    r = row(Price="10750000")
    r["Floor Area (m2)"] = "929"
    kept, _, _ = dr.classify([r])
    assert kept[0]["price_eur"] == 10_750_000


def test_missing_area_is_kept_for_the_benchmark_to_handle():
    r = row()
    r["Floor Area (m2)"] = "N/A"
    kept, _, _ = dr.classify([r])
    assert kept[0]["floor_area_m2"] is None


def test_bedrooms_trailing_comma_is_cleaned_and_counted():
    r = row()
    r["Number of Bedrooms"] = "2,"
    kept, _, cleanups = dr.classify([r])
    assert kept[0]["bedrooms"] == 2 and cleanups["Bedrooms had a trailing comma"] == 1


def test_bedrooms_that_are_not_numbers_are_dropped():
    r = row()
    r["Number of Bedrooms"] = "lots"
    assert dr.classify([r])[1]["Bedrooms not a valid number"] == 1


# ---- duplicates and groups ------------------------------------------------------------------

def test_exact_duplicates_keep_the_first_copy_only():
    kept, dropped, _ = dr.classify([row(), row()])
    assert len(kept) == 1 and dropped["Exact duplicate row"] == 1 and kept[0]["source_row"] == 1


def test_repeat_adverts_share_a_group_and_other_homes_do_not():
    a, b, c = row(), row(Price="310000"), row(Title="2 Main St, Co. Cork")
    kept, _, _ = dr.classify([a, b, c])
    assert kept[0]["group"] == kept[1]["group"] != kept[2]["group"]


def test_same_title_at_different_coordinates_is_a_different_property():
    kept, _, _ = dr.classify([row(), row(Latitude="53.3", Longitude="-6.2")])
    assert kept[0]["group"] != kept[1]["group"]


def test_title_case_and_spacing_do_not_split_a_group():
    assert dr.group_id("1  Main St", "1", "2") == dr.group_id(" 1 main st ", "1", "2")


# ---- BER ------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw, band", [
    ("A1", "A"), ("B3", "B"), ("C2", "C"), ("D1", "D"), ("E2", "E"), ("F", "F"), ("G", "G"),
    ("N/A", "Unknown"), ("NA", "Unknown"), ("SI_666", "Unknown"), ("BER_PENDING", "Unknown"),
    ("A2A3", "Unknown"), ("FG", "Unknown"), ("", "Unknown"),
])
def test_ber_mapping(raw, band):
    assert dr.ber_band(raw) == band


# ---- the report adds up ---------------------------------------------------------------------

def make_csv(tmp_path, rows):
    p = tmp_path / "daft_housing_data.csv"
    with p.open("w", newline="") as f:
        w = csv.DictWriter(f, COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return p


def test_every_row_is_kept_or_dropped_once_and_the_hash_is_recorded(tmp_path):
    rows = [row(), row(), row(Property_Type="Site"), row(Price="From 1"), row(County="Down"), row(Title="x", Price="1")]
    p = make_csv(tmp_path, rows)
    dr.main(p, tmp_path / "report.md")
    text = (tmp_path / "report.md").read_text()
    assert dr.sha256(p) in text and "6 data rows" in text
    kept, dropped, _ = dr.classify(rows)
    assert len(kept) + sum(dropped.values()) == 6


def test_sparse_counties_get_a_support_warning(tmp_path):
    p = make_csv(tmp_path, [row(Title=f"{i} Main St") for i in range(5)])
    dr.main(p, tmp_path / "r.md")
    assert "| Cork | 5 | support warning |" in (tmp_path / "r.md").read_text()


# ---- the real file (skipped where the dataset is not present) --------------------------------

REAL = Path("data/raw/daft_housing_data.csv")


@pytest.mark.skipif(not REAL.exists(), reason="raw dataset not downloaded")
def test_real_file_matches_the_plan_and_adds_up():
    rows = list(csv.DictReader(REAL.open(newline="", encoding="utf-8")))
    kept, dropped, _ = dr.classify(rows)
    assert len(rows) == 14289 and len(kept) + sum(dropped.values()) == len(rows)
    assert dropped["Site (land, not a home)"] == 2713 and dropped["Exact duplicate row"] == 8
    assert dropped["From price (development advert)"] == 220 and dropped["Sterling price"] == 1
    assert {r["property_type"] for r in kept} <= set(dr.SUPPORTED_TYPES)
