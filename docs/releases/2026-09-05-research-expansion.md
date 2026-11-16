# Research expansion — 5 September 2026

## Scope

Publish the prepared HANZE v2.1.1 records outside Greece as an optional affected-administrative-regions layer in Floods. Retain source IDs, intervals, impact definitions, notes, references, licence and possible related records. Load geometry by country; keep Greek catalogue filters and statistics separate. Polygons do not describe inundation extent, and source records are not necessarily distinct disasters.

Apply the 12 prepared updates (23 fields) to both the JSONL exports and the live database: citation and specimen-qualified microstructure for 11 existing Sri Lankan beachrocks, and the cited Mandra date interval in its information text. Preserve existing coordinates, dating fields, mineral classes and fatality values.

The source package is `../research/2026-09-05-global-expansion/preparation-batch-1/` relative to this repository. It contains the PRISMA screening trail, exact proposals, source locators and input fingerprints. Other candidate additions remain held for extraction or reconciliation.

## Implementation and publication

1. Derive country GeoJSON files and public provenance from the prepared material, retaining original geometry coordinates and attributes.
2. Apply exact, guarded catalogue changes; retain forward and reverse SQL patches.
3. Add a country/year selector, separate source-record list and full record popups to the existing flood map.
4. Commit only release files and transfer the commit through the established Git-bundle/SSH route to the NKUA VPS.
5. Back up the live database; apply the SQL transaction; publish static files into the existing web container and capture the resulting image for persistence without an image build.

No tests, builds, lint/type checks, diff/status checks or browser/visual verification are run, following the user's instruction. Deployment command outcomes are recorded separately; a successful command is not an independent functional or scientific review.

## Recovery

The release script saves the previous web image and a PostgreSQL custom-format dump under `/opt/nkua-webgis/backups/`. The reverse SQL patch restores only these 23 fields and refuses unexpected values. A future deployment from source includes the same updated assets and JSONL exports. Do not restore a whole database dump over later work without reconciliation.
