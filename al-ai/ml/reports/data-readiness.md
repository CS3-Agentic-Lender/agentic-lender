# Data readiness: Daft.ie Ireland House Properties 2024

Source file `daft_housing_data.csv`, SHA-256 `d4c1ea0be20fa1b6b4720dcdea92fb8bda22b209efc4174689ff319f4d40ec4c`, 14,289 data rows. The raw file is not in git.

## Every row, kept or dropped

A row is counted under the first rule it breaks, in this order, so the table adds up.

| Outcome | Rows |
| --- | --- |
| Dropped: Exact duplicate row | 8 |
| Dropped: Site (land, not a home) | 2,713 |
| Dropped: Price on Application | 548 |
| Dropped: From price (development advert) | 220 |
| Dropped: AMV price (guide value) | 141 |
| Dropped: Sterling price | 1 |
| Dropped: Missing price | 24 |
| Dropped: Northern Ireland county | 53 |
| Dropped: Missing or unknown county | 248 |
| Dropped: Property type not supported | 25 |
| **Kept for the model** | **10,308** |
| **Total** | **14,289** |

Kept is 72.1% of the file. Supported property types: Detached, Semi-D, Terrace, End of Terrace, Bungalow, Apartment, Duplex, Townhouse. Republic of Ireland only.

## Missing floor area

1,932 of 10,308 kept rows (18.7%) have no floor area. Per the plan the main benchmark uses complete rows only: 8,376 complete rows. Any imputation is fitted inside each training fold.

## BER

Legacy subgrades are coarsened to A to G bands. Range labels and sentinels (N/A, NA, SI_666, BER_PENDING) are Unknown.

| Raw value | Band | Kept rows |
| --- | --- | --- |
| A1 | A | 26 |
| A2 | A | 289 |
| A3 | A | 235 |
| B1 | B | 132 |
| B2 | B | 396 |
| B3 | B | 958 |
| BER_PENDING | Unknown | 13 |
| C1 | C | 1,093 |
| C2 | C | 1,158 |
| C3 | C | 1,047 |
| D1 | D | 925 |
| D2 | D | 830 |
| E1 | E | 559 |
| E2 | E | 428 |
| F | F | 474 |
| FG | Unknown | 1 |
| G | G | 736 |
| N/A | Unknown | 298 |
| SI_666 | Unknown | 710 |

## Property types and counties (kept rows)

A support warning means fewer than 50 examples are expected in the development split (60% of the kept rows). It is a prototype warning, not a statistical confidence bound.

| Property type | Rows |  |
| --- | --- | --- |
| Detached | 4,195 |  |
| Semi-D | 1,927 |  |
| Terrace | 1,320 |  |
| End of Terrace | 539 |  |
| Bungalow | 770 |  |
| Apartment | 1,302 |  |
| Duplex | 124 |  |
| Townhouse | 131 |  |

| County | Rows |  |
| --- | --- | --- |
| Carlow | 95 |  |
| Cavan | 138 |  |
| Clare | 222 |  |
| Cork | 1,385 |  |
| Donegal | 434 |  |
| Dublin | 2,880 |  |
| Galway | 597 |  |
| Kerry | 400 |  |
| Kildare | 318 |  |
| Kilkenny | 194 |  |
| Laois | 172 |  |
| Leitrim | 111 |  |
| Limerick | 305 |  |
| Longford | 86 |  |
| Louth | 232 |  |
| Mayo | 451 |  |
| Meath | 239 |  |
| Monaghan | 60 | support warning |
| Offaly | 136 |  |
| Roscommon | 237 |  |
| Sligo | 145 |  |
| Tipperary | 284 |  |
| Waterford | 187 |  |
| Westmeath | 165 |  |
| Wexford | 479 |  |
| Wicklow | 356 |  |

## Repeat adverts

Kept rows fall into 10,200 property groups (same title and coordinates). 108 rows are repeat adverts of a property already in the data, and the largest group has 3 rows. A group is never split across the development, calibration and test partitions or across folds.

Residual uncertainty: 214 coordinate points carry more than one title (for example units in one building). These are treated as different properties, so some leakage between related units is possible.
