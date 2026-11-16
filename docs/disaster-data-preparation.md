# Disaster data preparation

This release adds the four collections agreed in the original roadmap. It does
not claim to catalogue every natural hazard or every event worldwide.

## Published source scope

| Collection | Source scope | Source records |
| --- | --- | ---: |
| Landslides | Served UGLC v2, NASA COOLR and Northern Peloponnese inventories | 2,122,083 |
| Tsunamis | Complete NOAA public GIS event/observation layers; populated Greek impact CSV rows | 37,027 |
| Wildfires | Complete EFFIS public WFS perimeter download and MTBS national perimeter archive | 137,028 |
| Earthquakes | Complete NOAA significant-earthquake GIS layer; USGS significance ≥600, 1900–7 September 2026 | 15,811 |

These are source-record counts. Several observations, geometries or inventories
can describe the same event. Each collection discloses its geographic, temporal,
measurement and reporting limits in its source library and statistical glossary.

## Acquisition and processing

- `tools/landslides/` contains the landslide acquisition and processing tools.
- `tools/hazards/acquire_noaa.py` downloads NOAA event, coastal observation and
  significant-earthquake feature layers through the official published services,
  in stable object-ID order, following every result page.
- `tools/hazards/acquire_usgs.py` downloads the explicitly scoped USGS query in
  decade intervals. `prepare_earthquakes.py` resolves interval overlaps by exact
  USGS event ID. Missing decade archives prevent preparation from proceeding.
- `tools/hazards/acquire_wildfires.py` downloads and extracts the public EFFIS and
  MTBS archives. It never submits an email-based data request.
- Greek tsunami input: the public CSV and repository metadata at
  https://zenodo.org/records/10199521, archived locally as `greek-impact.csv`
  and `greek-metadata.json` in the tsunami acquisition folder.
- `prepare_tsunamis.py`, `prepare_wildfires.py`, `prepare_earthquakes.py` create
  source-preserving catalogue records and compressed detail shards. Wildfire
  shards are written incrementally to avoid retaining all polygon coordinates
  in memory. Numerical methods are included in each collection manifest.
- `collection.py` applies the established NKUA interface shell.
  `sharing.mjs COLLECTION...` produces social artwork from source locations.
  `map-previews.mjs COLLECTION...` produces separate homepage map screenshots
  from the local collection interfaces, using the configured preview server.
  `templates.py COLLECTION...` writes CSV-compatible Data / Field guide XLSX
  workbooks and adds their download links. Run it after shell preparation.
  `register.py COLLECTION...` adds homepage entries and local route/counter keys.
- `restore_mtbs_encoding.py` was used once to apply the CPG-declared ISO-8859-1
  encoding to the first prepared MTBS text without altering geometries. The
  main wildfire processor now uses that encoding directly.

Acquisition archives are outside the served website, under the sibling research
directories `2026-09-07-landslides`, `2026-09-07-tsunamis`,
`2026-09-07-wildfires` and `2026-09-07-earthquakes`. Each served record preserves
its original source ID, original attributes, citation, reuse terms and source
link. Display GeoJSON and filtered CSV exports retain provenance.

## Interpretation choices

- NOAA `TSEVENT_ID` links coastal observations to tsunami events; it does not
  make all observations separate disasters. Greek records have no shared NOAA
  identifier and retain their own source identity.
- NOAA doubtful/erroneous event classes and observation doubt flags remain
  explicit. They are not converted into an NKUA quality score.
- Greek zero earthquake magnitudes for marine-slide records are placeholders,
  not measured magnitude zero. The source CSV contains 15 populated records,
  despite a repository description mentioning 16.
- MTBS includes prescribed burns as well as wildfires and imposes minimum fire
  size thresholds. EFFIS first/final detection intervals do not measure active
  fire duration. Interior map pins are display anchors, not ignition locations.
- EFFIS source hectares and converted MTBS acres remain distinct from areas
  calculated from valid WGS84 polygons. Geodesic area subtracts holes; perimeter
  includes all boundaries. Invalid geometries are excluded from derived metrics.
- Earthquake preferred magnitude scales are not homogenized. Mw-family values
  have a separate numerical variable. Historical MMI, ShakeMap estimated MMI,
  DYFI intensity and PAGER potential-impact levels remain separate.
- USGS tsunami-link flags do not confirm tsunami occurrence. Source GeoJSON's
  kilometre depth coordinate is retained as an attribute while display geometry
  uses two coordinates, avoiding confusion with altitude in metres.
- Qualitative casualty ranges are not replaced with invented exact counts.
  Missing values remain missing. Cross-source impact totals are not summed.

Application checks and browser verification were not run for these new pages,
following the user's specific workspace instructions. Publication uses the
existing runtime image and persistent static releases described in
`docs/releases/2026-09-07-static-publication.md`.
