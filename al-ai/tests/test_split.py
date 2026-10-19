import random

from ml import split

COUNTIES = ["Cork", "Dublin", "Leitrim"]


def make_rows(n_groups=300, seed=1):
    """Synthetic kept rows: groups of 1 to 3 repeat adverts spread over a few counties."""
    rng = random.Random(seed)
    rows, row_id = [], 0
    for g in range(n_groups):
        county = rng.choices(COUNTIES, weights=[5, 10, 1])[0]
        for _ in range(rng.choice([1, 1, 1, 2, 3])):
            row_id += 1
            rows.append({"source_row": row_id, "group": f"g{g}", "county": county})
    return rows


def test_no_property_group_is_split_across_partitions():
    rows = make_rows()
    where = split.partition(rows, seed=42)
    assert split.leaked_groups(rows, where) == []


def test_every_row_lands_in_exactly_one_partition_and_proportions_are_close():
    rows = make_rows()
    where = split.partition(rows, seed=42)
    assert set(where) == {r["source_row"] for r in rows}
    s = split.summary(rows, where)["rows"]
    total = sum(s.values())
    assert abs(s["development"] / total - 0.6) < 0.03
    assert abs(s["calibration"] / total - 0.2) < 0.03 and abs(s["test"] / total - 0.2) < 0.03


def test_counties_are_balanced_each_on_their_own():
    rows = make_rows(n_groups=600)
    s = split.summary(rows, split.partition(rows, seed=42))["by_county"]
    for county in ("Cork", "Dublin"):
        n = sum(s[county].values())
        assert abs(s[county]["development"] / n - 0.6) < 0.06


def test_same_seed_same_split_and_a_different_seed_differs():
    rows = make_rows()
    assert split.partition(rows, 42) == split.partition(rows, 42)
    assert split.partition(rows, 42) != split.partition(rows, 43)


def test_the_split_does_not_depend_on_row_order():
    rows = make_rows()
    shuffled = rows[:]
    random.Random(9).shuffle(shuffled)
    assert split.partition(rows, 42) == split.partition(shuffled, 42)


def test_a_tiny_county_is_reported_when_it_misses_a_partition():
    rows = make_rows() + [{"source_row": 10_000, "group": "lonely", "county": "Sligo"}]
    s = split.summary(rows, split.partition(rows, 42))
    assert "Sligo" in s["counties_missing_from_a_partition"]


def test_folds_keep_groups_whole_cover_every_row_and_are_balanced():
    rows = make_rows()
    f = split.folds(rows, k=5, seed=42)
    assert set(f) == {r["source_row"] for r in rows} and set(f.values()) == set(range(5))
    by_group = {}
    for r in rows:
        by_group.setdefault(r["group"], set()).add(f[r["source_row"]])
    assert all(len(v) == 1 for v in by_group.values())
    sizes = [list(f.values()).count(i) for i in range(5)]
    assert max(sizes) - min(sizes) <= 5
    assert split.folds(rows, 5, 42) == f
