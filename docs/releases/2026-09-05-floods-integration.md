# Floods interface correction

The initial HANZE release used a separate, collapsed country/polygon control above the sidebar tabs and did not add HANZE pins or update the existing Sources modal. This did not match the requested integrated WebGIS experience.

The correction follows Lagoons: ordinary clustered pins, one existing sidebar, and record cards using the same preview-map component and locator layout. Country/territory, source catalogue and flood type join the existing filter picker and query builder. Search includes countries and catalogues. Statistics distinguish source catalogues and count source records. The separate HANZE panel and stylesheet are removed.

HANZE's original geography remains affected administrative regions. New map positions are explicitly derived display anchors within the largest polygon component (by EPSG:4326 coordinate area), not observed flood-site locations. The reproducible index generator is `tools/create-hanze-map-index.py` and uses Shapely 2.1.2. Original geometries and attributes remain intact. A selected record's original polygon loads on demand and is downloadable from its card.

The Sources modal now contains the Greek catalogue publication, HANZE v2.1.1 dataset, Paprotny et al. (2024) methods publication, bibliography/provenance links, scope and location qualifications, and the Mandra supporting publication. Mandra's additional information is also displayed in its record card.

Only static flood assets are deployed by `infra/scripts/ship.ps1 -FloodsIntegration`; the completed catalogue database enrichment is not reapplied. The previous web image is retained for recovery. No tests, builds, linters, type checks, diff/status checks or browser/visual verification are run, following the user's standing instruction. Existing server request logs were read to trace delivery of Greek marker data.
