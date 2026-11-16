# Floods in Mani, Greece — 15 Aug 2026

Static, unlisted WebGIS of the NKUA field survey of the 15 August 2026 flash floods
in Mani (survey 18 August 2026): 50 survey points at six locations (L01 Οίτυλο,
L02 Καραβοστάσι, L03 Νέο Οίτυλο, L04 Αλύπα, L05 Κοκκάλα, L06 Έξω Νύμφιο) with
200 field photographs.

The page contains noindex, nofollow, noarchive, and noimageindex directives. This
keeps the route out of search indexes and the site is not linked from the
collection homepage. Anyone who receives the URL can still access it; unlisted
is not access control.

## Data entrypoint and schema

The application fetches ./data/stations.geojson, generated from the survey
database (Photos/Alex/Database) by webgis/tools/build_webgis_data.py. It is a
GeoJSON FeatureCollection of Point features (WGS84, longitude first).

Top-level metadata: schema_version 2.0.0, location_count, point_count,
field_photo_count, locations (code, names, ELSTAT settlement and community,
points), coordinate_source, spatial_accuracy and position_accuracy_m.

Each feature:

    {
      "type": "Feature",
      "id": "L04_S02c",
      "properties": {
        "placemark_id": "L04_S02c", "point": "S02c", "station_code": "S02",
        "location_code": "L04", "location_name_el": "Αλύπα", "location_name_en": "Alypa",
        "easting_egsa87": 363164.2, "northing_egsa87": 4047383.8,
        "position_method": "manual_google_earth_streetview", "position_accuracy_m": 2,
        "coordinate_source": "...", "coordinate_precision_status": "...",
        "event_date": "2026-08-15", "survey_date": "2026-08-18",
        "first_photo_time": "2026-08-18T13:17+03:00", "last_photo_time": "2026-08-18T13:18+03:00",
        "photo_count": 8, "reference_image_count": 0,
        "setting": "road_edge", "note": "...",
        "region_name": "...", "regional_unit_name": "...",
        "municipality_code": "2434302", "municipality_name": "ΔΗΜΟΣ ΑΝΑΤΟΛΙΚΗΣ ΜΑΝΗΣ",
        "municipal_unit_code": "243430202", "municipal_unit_name": "...",
        "community_code": "24343020203", "community_name": "Δημοτική Κοινότητα Έξω Νυμφίου",
        "settlement_code": "2434302020302", "settlement_name": "Αλύπα", "settlement_population_2021": 11,
        "images": [{"kind": "field_photo", "media_id": "L04_S02c_01", "capture_time": "...",
                    "preview_url": ".../media/L04_Alypa/S02/preview/....jpg",
                    "full_url": ".../media/L04_Alypa/S02/full/....png", "alt": "...", "caption": "..."}]
      },
      "geometry": {"type": "Point", "coordinates": [22.4725, 36.5647]}
    }

The validator requires unique ids of the form L01_S01a matching location_code and
point, the event and survey dates, and agreement with point_count and
location_count. A photograph shared by two points is listed at both; within one
point a URL is shown once.

Media live under ./media/<code>_<LatinName>/<station>/{full,preview}: full PNG
copies plus JPEG and WebP previews (longer side 960 px). Residents' media from
Κοκκάλα are not published (reuse terms unknown). Downloads in ./data: the survey
database (Mani_Floods_2026_survey.xlsx, .gpkg) and Mani_Floods_2026_L01-L06.kmz.

Street View references (31 images, for 38 field photographs) are rendered from
Google Street View panoramas by webgis/tools/streetview_references.py at the
frames the survey team reviewed, 110 degrees wide. Their imagery date, viewpoint
and direction are in the database's ref_views layer; in stations.geojson their
capture_time is the imagery month (YYYY-MM).

## Provenance and limits

The point positions and photo-to-point assignments come from the survey team's
Google Earth Pro placemarks (L01 export; L02-L06 edited 3 November 2026). The
team placed each point by hand in Google
Earth Pro from the field photographs, field memory and Google Street View, and
checked every position against Street View to better than 2 m (stated by the
team, 3 November 2026). The source HEIC, PNG and TIFF files carry no camera GPS
fields, so positions come from that placement, not from photo metadata.

Web galleries load JPEG previews and link to full PNG copies. Capture timestamps
are retained in image metadata and represented at minute precision in public
filenames. Lossless TIFF masters remain offline. Platform content and the field
photographs are published under CC BY 4.0 (decided 3 November 2026). Reference
images labelled Google Street View remain third-party material under Google's
terms.

## UI parity

The page uses the shared /webgis-shared/lagoons-ui.css,
/webgis-shared/last-updated.css, /webgis-shared/feature-guide.css and .js,
/webgis-shared/common-map.js, and /webgis-shared/common-ui.js. It matches the
other NKUA WebGIS catalogues: NKUA masthead, editorial welcome poster,
Filters/Search/Statistics sidebar (point filters: location, station, setting,
reference images, municipal unit, community; eight statistics variables), Leaflet basemap and measurement controls, legend coloured by location
(Map display can recolour by setting, municipal unit or community), record modal with every field of the database
points table with title block, photo galleries and Location /
Survey detail sections, an in-page photo viewer (arrow keys, full-resolution
link), a "What is a flash flood?" guide, Sources & citations, Submit data with
CSV/XLSX templates, visit counter, team footer with the CC BY 4.0 licence line,
and mobile panel behavior. No nationwide disaster layers are loaded; the initial
view fits all survey points.

The submission templates in templates/ and the field tables in the Submit data
modal are generated together by webgis/tools/build_submission_templates.py in the
research repository (requires openpyxl).

## Local preview and checks

Serve the repository sites directory so absolute /webgis-shared/ assets resolve:

    Set-Location <repository>\sites
    python -m http.server 8765

Open http://127.0.0.1:8765/mani-floods-2026/.

Run the focused static and data audit:

    python .\mani-floods-2026\tests\audit_site.py

For shell-only development before the real GeoJSON is staged, pass
--allow-missing-data. That validates the site shell but does not count as a
release check.
