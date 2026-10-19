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
| Dropped: Floor area outside 15 to 1,000 m2 (quarantined) | 227 |
| **Kept for the model** | **10,081** |
| **Total** | **14,289** |

Kept is 70.6% of the file. Supported property types: Detached, Semi-D, Terrace, End of Terrace, Bungalow, Apartment, Duplex, Townhouse. Republic of Ireland only.

## Missing floor area

1,932 of 10,081 kept rows (19.2%) have no floor area. Per the plan the main benchmark uses complete rows only: 8,149 complete rows. Any imputation is fitted inside each training fold.

## BER

Legacy subgrades are coarsened to A to G bands. Range labels and sentinels (N/A, NA, SI_666, BER_PENDING) are Unknown.

| Raw value | Band | Kept rows |
| --- | --- | --- |
| A1 | A | 26 |
| A2 | A | 286 |
| A3 | A | 231 |
| B1 | B | 132 |
| B2 | B | 393 |
| B3 | B | 952 |
| BER_PENDING | Unknown | 13 |
| C1 | C | 1,084 |
| C2 | C | 1,151 |
| C3 | C | 1,028 |
| D1 | D | 913 |
| D2 | D | 820 |
| E1 | E | 549 |
| E2 | E | 423 |
| F | F | 465 |
| FG | Unknown | 1 |
| G | G | 724 |
| N/A | Unknown | 202 |
| SI_666 | Unknown | 688 |

## Property types and counties (kept rows)

A support warning means fewer than 50 examples are expected in the development split (60% of the kept rows). It is a prototype warning, not a statistical confidence bound.

| Property type | Rows |  |
| --- | --- | --- |
| Detached | 4,019 |  |
| Semi-D | 1,918 |  |
| Terrace | 1,316 |  |
| End of Terrace | 535 |  |
| Bungalow | 741 |  |
| Apartment | 1,299 |  |
| Duplex | 123 |  |
| Townhouse | 130 |  |

| County | Rows |  |
| --- | --- | --- |
| Carlow | 91 |  |
| Cavan | 136 |  |
| Clare | 216 |  |
| Cork | 1,369 |  |
| Donegal | 412 |  |
| Dublin | 2,872 |  |
| Galway | 534 |  |
| Kerry | 395 |  |
| Kildare | 311 |  |
| Kilkenny | 186 |  |
| Laois | 170 |  |
| Leitrim | 107 |  |
| Limerick | 298 |  |
| Longford | 85 |  |
| Louth | 229 |  |
| Mayo | 432 |  |
| Meath | 239 |  |
| Monaghan | 59 | support warning |
| Offaly | 129 |  |
| Roscommon | 232 |  |
| Sligo | 139 |  |
| Tipperary | 275 |  |
| Waterford | 185 |  |
| Westmeath | 160 |  |
| Wexford | 465 |  |
| Wicklow | 355 |  |

## Repeat adverts

Kept rows fall into 9,978 property groups (same title and coordinates). 103 rows are repeat adverts of a property already in the data, and the largest group has 3 rows. A group is never split across the development, calibration and test partitions or across folds.

Residual uncertainty: 203 coordinate points carry more than one title (for example units in one building). These are treated as different properties, so some leakage between related units is possible.
