"""Data readiness for the valuation model: which Daft.ie 2024 listings we can train on, and why the rest are dropped.

Every row of the source CSV ends up either kept or dropped for exactly one reason, so the report adds up.
The raw CSV and any row-level data stay out of git (al-ai/data/ is ignored); only the aggregate report is committed.

    uv run python ml/data_readiness.py            # from al-ai/ or al-ai/ml/, reads al-ai/data/raw/daft_housing_data.csv
    prun --pull ml/reports ml/data_readiness.py   # on the PC (the dataset is mounted at /data)
"""

import csv
import hashlib
import os
import re
import sys
from collections import Counter
from pathlib import Path

# Local runs read al-ai/data/raw whatever folder you run from. On the PC server (prun) the dataset is mounted at /data.
LOCAL_DATA = Path(__file__).resolve().parent.parent / "data" / "raw"
DATA_DIR = Path(os.environ.get("AL_DATA_DIR") or ("/data" if Path("/data/daft_housing_data.csv").exists() else LOCAL_DATA))
CSV_PATH = DATA_DIR / "daft_housing_data.csv"
REPORT_PATH = Path(__file__).parent / "reports" / "data-readiness.md"

SUPPORTED_TYPES = ["Detached", "Semi-D", "Terrace", "End of Terrace", "Bungalow", "Apartment", "Duplex", "Townhouse"]
REPUBLIC_COUNTIES = {
    "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois",
    "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo",
    "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow",
}
NORTHERN_IRELAND = {"Antrim", "Armagh", "Down", "Fermanagh", "Derry", "Tyrone"}
# Plausible floor area for a home, decided before any model comparison. Areas under 15 are land in acres or hectares typed
# as houses (0.05, 0.3), and areas over 1,000 are typos or square feet (up to 1,821,087). Genuine big homes (929 m2, EUR 10.75m)
# stay in: the rule looks at area only, never at price. Quarantined rows are counted in the report, not deleted from the file.
MIN_AREA_M2, MAX_AREA_M2 = 15, 1000
SPARSE_BELOW = 50 # fewer development examples than this is a support warning, not a confidence bound
DEVELOPMENT_SHARE = 0.6  # the 60/20/20 split keeps 60% of the kept rows for development

# Legacy BER subgrades are coarsened to the ordered A to G bands. Ranges and sentinels are Unknown, never a guessed grade.
BER_BANDS = {**{f"{b}{n}": b for b in "ABCDE" for n in "123"}, **{b: b for b in "ABCDEFG"}}
BER_UNKNOWN = "Unknown"

# Order matters: a row is counted under the first rule it breaks.
REASONS = [
    "Exact duplicate row",
    "Site (land, not a home)",
    "Price on Application",
    "From price (development advert)",
    "AMV price (guide value)",
    "Sterling price",
    "Missing price",
    "Unrecognised price",
    "Northern Ireland county",
    "Missing or unknown county",
    "Property type not supported",
    "Floor area outside 15 to 1,000 m2 (quarantined)",
    "Bedrooms not a valid number",
]


def price_problem(price: str) -> tuple[int | None, str | None]:
    """The asking price in euro, or the reason it cannot be used."""
    p = price.strip()
    if re.fullmatch(r"\d+", p):
        return (int(p), None) if int(p) > 0 else (None, "Missing price")
    if p.endswith("Price on Application"):  # also "AMV: Price on Application"
        return None, "Price on Application"
    if p.startswith("From"):
        return None, "From price (development advert)"
    if p.startswith("AMV:"):
        return None, "AMV price (guide value)"
    if p.startswith("£"):
        return None, "Sterling price"
    if p in ("", "N/A", "NA"):
        return None, "Missing price"
    return None, "Unrecognised price"


def ber_band(raw: str) -> str:
    return BER_BANDS.get(raw.strip(), BER_UNKNOWN)


def norm_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.strip().lower())


def group_id(title: str, lat: str, lon: str) -> str:
    """Repeat adverts of one property share a title and coordinates, so they share a group and are never split across folds."""
    return hashlib.sha1(f"{norm_title(title)}|{lat.strip()}|{lon.strip()}".encode()).hexdigest()[:12]


def classify(rows: list[dict]) -> tuple[list[dict], Counter, Counter]:
    """Returns (kept rows, why the others were dropped, small cleanups made on kept rows)."""
    kept, dropped, cleanups = [], Counter(), Counter()
    seen = set()
    for n, row in enumerate(rows, start=1):  # n is the stable source-row identifier (data row number)
        key = tuple(row.values())
        if key in seen:
            dropped["Exact duplicate row"] += 1
            continue
        seen.add(key)
        ptype, county = row["Property Type"].strip(), row["County"].strip()
        price, why = price_problem(row["Price"])
        if ptype == "Site":
            why = "Site (land, not a home)"
        elif county in NORTHERN_IRELAND and why is None:
            why = "Northern Ireland county"
        elif why is None and county not in REPUBLIC_COUNTIES:
            why = "Missing or unknown county"
        elif why is None and ptype not in SUPPORTED_TYPES:
            why = "Property type not supported"
        area_raw = row["Floor Area (m2)"].strip()
        area = float(area_raw) if re.fullmatch(r"\d+(\.\d+)?", area_raw) else None
        if why is None and area is not None and not MIN_AREA_M2 <= area <= MAX_AREA_M2:
            why = "Floor area outside 15 to 1,000 m2 (quarantined)"
        beds_raw = row["Number of Bedrooms"].strip().rstrip(",")
        if why is None and not re.fullmatch(r"\d+", beds_raw):
            why = "Bedrooms not a valid number"
        if why:
            dropped[why] += 1
            continue
        if beds_raw != row["Number of Bedrooms"].strip():
            cleanups["Bedrooms had a trailing comma"] += 1
        kept.append({
            "source_row": n, "county": county, "property_type": ptype, "bedrooms": int(beds_raw),
            "floor_area_m2": area, "ber": ber_band(row["BER Rating"]), "ber_raw": row["BER Rating"].strip(),
            "price_eur": price, "title": row["Title"], "lat": row["Latitude"], "lon": row["Longitude"],
            "group": group_id(row["Title"], row["Latitude"], row["Longitude"]),
        })
    return kept, dropped, cleanups


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def table(header: list[str], rows: list[list]) -> str:
    line = lambda cells: "| " + " | ".join(str(c) for c in cells) + " |"
    return "\n".join([line(header), line(["---"] * len(header))] + [line(r) for r in rows])


def build_report(path: Path, total: int, kept: list[dict], dropped: Counter, cleanups: Counter) -> str:
    assert len(kept) + sum(dropped.values()) == total, "every row must be kept or dropped exactly once"
    pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "0.0%"
    missing_area = sum(r["floor_area_m2"] is None for r in kept)
    groups = Counter(r["group"] for r in kept)
    repeats = sum(c - 1 for c in groups.values())
    by_coords = {}
    for r in kept:
        by_coords.setdefault((r["lat"], r["lon"]), set()).add(norm_title(r["title"]))
    shared_coords = sum(1 for t in by_coords.values() if len(t) > 1)
    types, counties = Counter(r["property_type"] for r in kept), Counter(r["county"] for r in kept)
    ber_raw = Counter((r["ber_raw"] or "(blank)", r["ber"]) for r in kept)
    flag = lambda c: "support warning" if c * DEVELOPMENT_SHARE < SPARSE_BELOW else ""
    out = [
        "# Data readiness: Daft.ie Ireland House Properties 2024", "",
        f"Source file `{path.name}`, SHA-256 `{sha256(path)}`, {total:,} data rows. The raw file is not in git.", "",
        "## Every row, kept or dropped", "",
        "A row is counted under the first rule it breaks, in this order, so the table adds up.", "",
        table(["Outcome", "Rows"], [[f"Dropped: {r}", f"{dropped[r]:,}"] for r in REASONS if dropped[r]]
              + [["**Kept for the model**", f"**{len(kept):,}**"], ["**Total**", f"**{total:,}**"]]), "",
        f"Kept is {pct(len(kept), total)} of the file. Supported property types: {', '.join(SUPPORTED_TYPES)}. "
        "Republic of Ireland only.", "",
        "## Missing floor area", "",
        f"{missing_area:,} of {len(kept):,} kept rows ({pct(missing_area, len(kept))}) have no floor area. "
        "Per the plan the main benchmark uses complete rows only: "
        f"{len(kept) - missing_area:,} complete rows. Any imputation is fitted inside each training fold.", "",
        "## BER", "",
        "Legacy subgrades are coarsened to A to G bands. Range labels and sentinels (N/A, NA, SI_666, BER_PENDING) are Unknown.", "",
        table(["Raw value", "Band", "Kept rows"], [[k[0], k[1], f"{v:,}"] for k, v in sorted(ber_raw.items())]), "",
        "## Property types and counties (kept rows)", "",
        f"A support warning means fewer than {SPARSE_BELOW} examples are expected in the development split "
        f"({DEVELOPMENT_SHARE:.0%} of the kept rows). It is a prototype warning, not a statistical confidence bound.", "",
        table(["Property type", "Rows", ""], [[t, f"{types[t]:,}", flag(types[t])] for t in SUPPORTED_TYPES]), "",
        table(["County", "Rows", ""], [[c, f"{n:,}", flag(n)] for c, n in sorted(counties.items())]), "",
        "## Repeat adverts", "",
        f"Kept rows fall into {len(groups):,} property groups (same title and coordinates). {repeats:,} rows are repeat "
        f"adverts of a property already in the data, and the largest group has {max(groups.values(), default=0)} rows. "
        "A group is never split across the development, calibration and test partitions or across folds.", "",
        f"Residual uncertainty: {shared_coords:,} coordinate points carry more than one title (for example units in one "
        "building). These are treated as different properties, so some leakage between related units is possible.", "",
    ]
    if cleanups:
        out += ["## Small cleanups", ""] + [f"- {k}: {v:,} rows" for k, v in cleanups.items()] + [""]
    return "\n".join(out)


def main(path: Path = CSV_PATH, report: Path = REPORT_PATH) -> None:
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    kept, dropped, cleanups = classify(rows)
    text = build_report(path, len(rows), kept, dropped, cleanups)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(text)
    print(text)


if __name__ == "__main__":
    main(Path(sys.argv[1])) if len(sys.argv) > 1 else main()
