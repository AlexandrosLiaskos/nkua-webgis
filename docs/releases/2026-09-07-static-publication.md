# Disaster collection publication

## Landslides — published

Release `20260907-landslides` was activated on 7 September 2026.
URL: https://nkua.cloud/landslides/

- 2,122,083 source records: UGLC 2,043,824; NASA COOLR 77,373;
  Northern Peloponnese 886.
- Sentinel reference and OMIV records are absent from the served catalogue.
- Shared interface, source-coloured clusters, record and definition dialogs,
  icons and social artwork, search, filters and numerical statistics are included.
- 1,002,746 valid footprint geometries support area and perimeter statistics.
- The earlier `2026-09-07-landslides.md` describes the initial local ingestion;
  this publication note supersedes its source counts and publication boundary.

## Tsunamis — published

Release `20260907-tsunamis` was activated after landslides.
URL: https://nkua.cloud/tsunamis/

- NOAA published layers: 2,583 event records and 34,429 coastal observations.
- Greek Tsunami Impact Database: all 15 populated CSV rows (the repository
  description says 16; that discrepancy is disclosed).
- Total: 37,027 source records. NOAA `TSEVENT_ID` supplies explicit event links.
- Original dates, validity classes, measurement types and attributes are retained.
- Statistics separate local water height from event maxima, and include
  inundation distance, travel time, period, earthquake Mw/depth, Greek intensity,
  reported impacts and chronology.
- Partial travel times remain in original attributes; a numerical total is
  calculated only when both source time components are supplied.

## Wildfires and earthquake impacts — published

Release `20260907-wildfires-earthquakes` was activated on 7 September 2026.
URLs: https://nkua.cloud/wildfires/ and https://nkua.cloud/earthquakes/.

- Wildfires: all 106,098 EFFIS WFS shapes and all 30,930 MTBS national perimeter
  records, totalling 137,028 source boundaries. MTBS metadata is dated
  6 September 2026 and identifies its period as 1984–2026. Prescribed burns
  retain their source classification. MTBS text uses its declared ISO-8859-1
  encoding. Geometries are converted from source CRS to WGS84; source area,
  ellipsoidal geometry area, perimeter, dates and intervals are separate fields.
- Earthquakes: all 6,634 NOAA published significant-earthquake records plus
  9,177 distinct USGS event IDs from the explicit 1900–7 September 2026 query
  with significance ≥600. Total: 15,811 source records. Provider IDs remove
  duplicate decade-boundary results. Historical impact counts, ShakeMap MMI,
  DYFI intensity and PAGER potential-impact alerts remain separate.
- The three new pages reuse the shared map, filters, statistics, typography,
  source colours, clusters, hover maps, three locator maps, record/source/about/
  submission/definition dialogs and mobile controls. CSV and XLSX submission
  templates, GeoJSON record exports, icons, manifests and social artwork are included.
- Wildfire seasonality uses named calendar months as categories. Provider IDs
  and month codes receive readable labels in record details and statistic lists.
- The final overlay includes the corrected tsunami travel-time values and all
  four map-interface homepage previews. Social-artwork generation no longer
  overwrites the map images.

## Homepage previews — published

The landslide and tsunami image fix was first published as
`20260907-homepage-map-previews`. The final release preserves those images and
adds matching wildfire and earthquake map previews. Updated image URLs refresh
browser caches. The capture tool creates image assets; it is not a browser test.

## Publication mechanism

`infra/scripts/publish-static.py` applies an uploaded tar archive of `sites/`
files to a persistent static release. It starts with the currently served site,
preserves earlier releases through hard links, and unlinks overlaid files before
replacement. It also records backups of overwritten source files and config.

Production release: `/opt/nkua-webgis/static/20260907-wildfires-earthquakes`.
Previous release: `/opt/nkua-webgis/static/20260907-homepage-map-previews`.
Baseline: `/opt/nkua-webgis/static/20260907-landslides-baseline`.
Final publication backups: `/opt/nkua-webgis/backups/20260907-wildfires-earthquakes`.
The `current` symlink is bind-mounted read-only into the web container together
with that release's internal nginx configuration. Future static publications
must update this release mount, rather than only rebuilding an image.

Only WebGIS web was recreated, using `--no-build --no-deps`. The existing visit
counter was restarted after adding the new site key. The database, API, shared
outer proxy, volumes, credentials and unrelated applications were not changed.
The outer proxy's existing root location already forwards new collection paths.

The publication command completed successfully and reported WebGIS web started.
No new tests, builds, linters,
type checks, git status/diff or post-publication browser checks were run.
