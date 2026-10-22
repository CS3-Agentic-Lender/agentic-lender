"""The 60/20/20 development / calibration / final-test split and the development folds.

Per the valuation plan: fixed seed, county-balanced where feasible, and every property group stays whole, so repeat
adverts of one property never sit on both sides of a split. Group separation beats exact proportions.
Pure Python, so it runs anywhere.
"""

import random
from collections import Counter, defaultdict

PARTITIONS = ("development", "calibration", "test")
SHARES = (0.6, 0.2, 0.2)


def _assign(items: list[tuple[str, int]], targets: list[float], rng: random.Random) -> dict[str, int]:
    """items are (group, rows). Shuffle, then give each group to the bucket furthest below its target share."""
    items = items[:]
    rng.shuffle(items)
    items.sort(key=lambda it: -it[1])  # big groups first (stable, so the shuffle breaks ties): fits proportions better
    filled = [0.0] * len(targets)
    out = {}
    for group, rows in items:
        bucket = max(range(len(targets)), key=lambda i: targets[i] - filled[i])
        out[group] = bucket
        filled[bucket] += rows
    return out


def partition(kept: list[dict], seed: int, shares: tuple = SHARES) -> dict[int, str]:
    """source_row -> partition name. Balanced by county: each county is split on its own, whole groups at a time."""
    by_county: dict[str, Counter] = defaultdict(Counter)
    for r in kept:
        by_county[r["county"]][r["group"]] += 1
    where: dict[str, str] = {}
    for county in sorted(by_county):  # sorted so the result doesn't depend on file order
        groups = sorted(by_county[county].items())
        total = sum(n for _, n in groups)
        buckets = _assign(groups, [s * total for s in shares], random.Random(f"{seed}|{county}"))
        where.update({g: PARTITIONS[b] for g, b in buckets.items()})
    return {r["source_row"]: where[r["group"]] for r in kept}


def folds(rows: list[dict], k: int, seed: int) -> dict[int, int]:
    """source_row -> fold 0..k-1 for the development rows. Whole property groups, balanced by row count."""
    sizes = Counter(r["group"] for r in rows)
    fold_of = _assign(sorted(sizes.items()), [len(rows) / k] * k, random.Random(f"{seed}|folds"))
    return {r["source_row"]: fold_of[r["group"]] for r in rows}


def summary(kept: list[dict], where: dict[int, str]) -> dict:
    """Aggregate counts only: rows per partition, overall and per county, and counties missing from a partition."""
    per = {p: Counter() for p in PARTITIONS}
    for r in kept:
        per[where[r["source_row"]]][r["county"]] += 1
    counties = sorted({r["county"] for r in kept})
    return {
        "rows": {p: sum(per[p].values()) for p in PARTITIONS},
        "by_county": {c: {p: per[p][c] for p in PARTITIONS} for c in counties},
        "counties_missing_from_a_partition": [c for c in counties if any(per[p][c] == 0 for p in PARTITIONS)],
    }


def leaked_groups(kept: list[dict], where: dict[int, str]) -> list[str]:
    """Groups that appear in more than one partition. Must be empty."""
    seen: dict[str, set] = defaultdict(set)
    for r in kept:
        seen[r["group"]].add(where[r["source_row"]])
    return [g for g, parts in seen.items() if len(parts) > 1]
