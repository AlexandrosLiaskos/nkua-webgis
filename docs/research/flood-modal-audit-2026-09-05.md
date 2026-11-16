# Flood record modal and event-identity audit — 5 September 2026

## Scope and result

Requested audit: every displayed flood record must retain available event information and its sources, omit empty fields, preserve source-specific meanings, and share one pin when records are confirmed to describe the same event.

The audit checked 1,992 live Greek records and 2,412 displayed HANZE v2.1.1 records. The live Greek records agreed with the repository export when compared by ID. All 4,404 records passed the source-to-card field checks. This is an exhaustive audit of the displayed records' mappings and rendering, not a claim that all underlying historical reports have been independently verified.

## Changes

- Omit nulls, blank strings and the Greek catalogue's underscore placeholders. Omit an entire impact section if it has no observations. Preserve numeric zero, including HANZE's explicitly reported zero fatalities.
- Restore 77 populated Greek rainfall-duration fields, 332 rainfall-amount fields and 1,595 HANZE river/lake/coastal-water fields. Greek rainfall units are not asserted unless independently supported; other values are labelled as catalogue values with unspecified units/periods.
- Keep HANZE fatality definitions, affected persons, reported inundated area, nominal currency and losses adjusted to 2020 EUR separate. Preserve all source notes, including uncertainty, approximation, co-occurring hazards and insured-loss qualifications.
- Preserve every nonempty HANZE reference label. Add 3,023 links to bibliographic entries where the match is unambiguous, including reviewed abbreviation matches for CRED (2023), UNDRR (2022) and Papagiannaki et al. (2022). This count is reference instances, not unique publications or independently assessed articles. Unresolved labels remain visible. For example, Brakenridge (2022) is not silently mapped to bibliography entry 102, which says 2017.
- Keep older region coding and source change history in the source data rather than filling event cards with administrative metadata. The public `source-events.csv` preserves all 20 original columns. It contains the complete 2,521-record HANZE source table; its 109 Greek records are not automatically added as map pins.
- Combine Greek pairs 322/323 and 1278/1279. Every event attribute agrees, including date, locality, coordinates and recorded impacts; only IDs and source URLs differ. Both IDs and both references appear in the single resulting card. Future differing observations are rendered with their record attribution instead of overwritten or summed.
- Retain all 4,404 source rows for filters and statistics; create 4,402 map pins. The welcome panel remains Records / Regions covered. No database rows are deleted.
- Guard against an earlier, slower pin-details request replacing the result of a later pin selection.

## Mandra and regional scope

Greek record 1743 retains its local observations. Soulios et al. (2018), page 132, supports 14–15 November 2017 and 23 fatalities. Pages 136–138 and 142 explain the approximate rainfall estimates and the absence of direct local rainfall measurements. The interval is presented as publication-supported evidence without inventing an exact catalogue commencement day.

HANZE 2135 is shown as evidence for the wider event in the same Mandra card, with its references. It covers EL306 and EL421, not Mandra alone. Its 24 fatalities, 5,200 persons affected, loss estimates and meteorological cause remain within the HANZE regional block. They are not substituted for, added to, or described as local Mandra observations. This association is regional context, not an adjudication that the two records have identical impact scope. It creates no additional pin.

## Screening and unresolved identities

All 109 previously held Greek HANZE records were screened against Greek catalogue dates and the original HANZE affected-region polygons, transformed from EPSG:3035 to EPSG:4326. Candidate generation used inclusive interval overlap and point-in-polygon membership; it does not constitute proof of event identity.

| Screening outcome | HANZE records |
| --- | ---: |
| At least one Greek record with date and region overlap | 62 |
| Only year/region candidates with missing Greek dates | 3 |
| Neither category yielded a candidate | 44 |
| Total screened | 109 |

Two of the 62 also have undated candidates. Mandra is one of the three with only year/region candidates, with additional publication evidence used for the regional association above. The 44 without a generated candidate are not automatically considered new events: differing dates, calendars, coding and spatial representations can prevent a match.

Five previously flagged HANZE overlap pairs were inspected: 102/103, 2571/761, 2840/1063, 1225/1226 and 1561/1562. Overlapping intervals and administrative regions alone do not justify merging these source records. In particular, the UK pair distinguishes river flooding from a coastal surge and has different impact scopes. The other pairs still require upstream event adjudication. Potential relationships remain labelled on the cards.

This screening log follows the existing review's reproducible inclusion/hold practice. It is not a new PRISMA-complete global literature review, nor proof that all real-world flood episodes have been deduplicated.

## Evidence and validation

- Dataset: [HANZE v2.1.1](https://doi.org/10.5281/zenodo.8410025), CC BY 4.0.
- Field definitions and event scope: [Paprotny, Terefenko and Śledziowski (2024)](https://essd.copernicus.org/articles/16/5145/2024/), sections 2.1–2.2 and Appendix A.
- Greek catalogue publication: [Evelpidou et al. (2023)](https://doi.org/10.3390/cli11110226). The publisher returned HTTP 403 for full text during this audit; no unverified catalogue-wide rainfall-unit convention was inferred.
- Mandra: [Soulios et al. (2018)](https://doi.org/10.12681/bgsg.16419), publisher PDF retrieved and inspected.
- `tools/audit-flood-modals.mjs`: exhaustive mapping, field-presence, preserved-value, zero, citation, grouping, source-scope and escaping checks. Uses the archived live Greek snapshot and prepared source JSONL in the sibling research workspace.
- Browser checks: Mandra's local and regional blocks; a single pin for Greek 322/323 with both links and no empty impact section; HANZE 2028 with zero fatalities, Fan river, 45 km², nominal ALL and adjusted EUR losses, original affected-region outline and source references. The combined Greek card had no empty values or horizontal overflow and all three locator maps rendered.

Detailed candidate records, the live snapshot and machine-readable rendering counts are retained under `research/2026-09-05-global-expansion/preparation-batch-1/modal-audit/` in the parent workspace. Record-level research is intentionally not added to the main Sources modal.
