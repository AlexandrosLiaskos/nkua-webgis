# NKUA WebGIS sites

This repository holds the source code of the WebGIS sites and research catalogues of the research team
of Professor Niki Evelpidou at the Department of Geology and Geoenvironment of the National and
Kapodistrian University of Athens (NKUA). The sites are published at <https://evelpidou.nkua.cloud/>
and <https://historicfloods.org/>.

The datasets that the sites show are not part of this repository. The sites read them from the
database of the server through its web API, or from data files that stay on the server. The section
[What is not in this repository](#what-is-not-in-this-repository) lists every part that was left out
and the reason.

- Home page: <https://evelpidou.nkua.cloud/>
- Recorded visits of all sites: <https://evelpidou.nkua.cloud/api/visits/summary>

## Repository

| Place | Contents |
|---|---|
| `sites/` | The pages: one folder for each site, the home page (`sites/index.html`), the code and styles that several sites share (`sites/webgis-shared/`) and the photographs of the team (`sites/team/`) |
| `infra/db/` | The database: the schema, the roles and the API functions (`001-schema.sql`), the script that runs the schema when the database is created (`001-init.sh`) and the later changes (`releases/`) |
| `infra/nginx/` | The configuration of the web server of the sites (`webgis.conf`) and of the address historicfloods.org (`historicfloods.conf`) |
| `infra/counter/` | The visit counter |
| `infra/scripts/`, `infra/systemd/` | Installation, publication, backup and the earlier release scripts |
| `tools/` | Programs that download the public source catalogues and prepare the data files of the hazard sites and of the floods site, and a check of the record windows of the floods site |
| `scripts/` | The program that builds the data submission templates in `sites/*/templates/` |
| `docs/` | Notes on the data preparation, on the address historicfloods.org and on the releases of September 2026 |
| `compose.yaml`, `Dockerfile` | The containers of the service |
| `.github/workflows/`, `tools/checks/` | The automatic checks |

## Sites

Each site is a folder of `sites/` with its own `index.html`. The pages are HTML, CSS and JavaScript
without a build step; the research catalogue builder is the one exception, and its built files are
included.

### Geospatial research catalogues — NKUA (home page)

- Address: <https://evelpidou.nkua.cloud/>
- Files: `sites/index.html`, with its script, style sheet and images in `sites/`
- The page lists every site with a preview and its number of recorded visits, which it reads from
  `/api/visits/summary`.

### February 2026 Storm Surges WebGIS

- Address: <https://evelpidou.nkua.cloud/Κακοκαιρία-Φεβ-2026/>
- Files: `sites/Κακοκαιρία-Φεβ-2026/`
- A page in Greek on the coastal impacts of the storms of February 2026 in Greece. It reads the storm
  events and the administrative boundaries from its `data/` folder. Each event links to the decisions
  published on Diavgeia (`assets/ada-pdfs/`) and to its images (`assets/images/`). None of these
  folders is included.

### Historic Floods of Earth WebGIS

- Addresses: <https://historicfloods.org/> and <https://evelpidou.nkua.cloud/floods/>
- Files: `sites/floods/`
- The records of the NKUA catalogue of floods in Greece come through the API. The records of the
  other flood catalogues that the page names come from prepared files in `data/`, which is not
  included. The site has its own citation file, `sites/floods/CITATION.cff`.

### Beach Rocks WebGIS

- Address: <https://evelpidou.nkua.cloud/beachrocks/>
- Files: `sites/beachrocks/`
- The beachrock records come through the API.

### Tombolo WebGIS

- Address: <https://evelpidou.nkua.cloud/tombolos/>
- Files: `sites/tombolos/`
- The tombolo records come through the API.

### Coastal Lagoons of Earth WebGIS

- Address: <https://evelpidou.nkua.cloud/lagoons/>
- Files: `sites/lagoons/`
- The lagoon records and outlines come through the API.

### Earthquakes WebGIS

- Address: <https://evelpidou.nkua.cloud/earthquakes/>
- Files: `sites/earthquakes/` and the shared script `sites/webgis-shared/hazard-atlas.js`
- The page reads prepared catalogue files from `data/`, which is not included. The programs in
  `tools/hazards/` make these files from the public source catalogues that the page credits.

### Tsunamis WebGIS

- Address: <https://evelpidou.nkua.cloud/tsunamis/>
- Files: `sites/tsunamis/` and `sites/webgis-shared/hazard-atlas.js`
- The page reads prepared catalogue files from `data/`, which is not included; `tools/hazards/`
  makes them from the public source catalogues that the page credits.

### Landslides WebGIS

- Address: <https://evelpidou.nkua.cloud/landslides/>
- Files: `sites/landslides/`
- The page reads prepared inventory files from `data/` (23,492 files, about 1 GB), which is not
  included. The programs in `tools/landslides/` make these files from the public inventories that
  the page credits.

### Wildfires WebGIS

- Address: <https://evelpidou.nkua.cloud/wildfires/>
- Files: `sites/wildfires/` and `sites/webgis-shared/hazard-atlas.js`
- The page reads prepared perimeter files from `data/`, which is not included; `tools/hazards/` makes
  them from the public archives that the page credits.

### Floods in Mani, Greece, 15 August 2026

- Address: <https://evelpidou.nkua.cloud/mani-floods-2026/>
- Files: `sites/mani-floods-2026/`
- The page shows the field survey of the floods. The survey files (`data/`) and the photographs of
  the survey points (`media/`) are not included.

### Mani Peninsula Flash Flood Reconstruction, Research Portal

- Address: <https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/>
- Files: `sites/Mani-Floods-Aug-2026/`: the portal page, its data page (`data/index.html`) and its
  code page (`src/index.html`)
- The data files of the portal and the model code that its code page offers are not in this
  repository.

### Κατανάλωση νερού άρδευσης στην Κύπρο 2018–2026

- Address: <https://evelpidou.nkua.cloud/cyprus-irrigation-2026/>
- Files: `sites/cyprus-irrigation-2026/`
- A page in Greek on the consumption of irrigation water in Cyprus from 2018 to 2026, based on data of
  FAO WaPOR version 3, as the page states. Its data files and raster layers (`data/`, `grids/`,
  `layers/`) are not included.

### Research catalogue builder

- Address: <https://evelpidou.nkua.cloud/prisma-builder/>
- Files: `sites/prisma-builder/`
- A page that creates, documents and exports a research resource catalogue as a static website. The
  folder holds release 20260909T091748Z of the builder, version 0.1.0 (`.prisma-builder-release.json`):
  `studio.js` is its built script, and the source project of the builder is not in this repository.
  `examples/new-study.json` is an empty sample project.

### Coastal flooding in Greece, February 2026 (research catalogue)

- Address: <https://evelpidou.nkua.cloud/catalogues/greek-coastal-storms/>
- The builder generated this catalogue site. Its pages, records and data files
  (`sites/catalogues/greek-coastal-storms/`) are not included.

### New research catalogue (builder sample)

- Address: <https://evelpidou.nkua.cloud/catalogues/new-study/>
- The builder generated this sample site (`sites/catalogues/new-study/`); it is not included.

## How the sites run

The service runs in four containers, which `compose.yaml` defines.

| Container | Image | Role |
|---|---|---|
| `nkua-webgis-web` | Built from `Dockerfile` on nginx 1.27 | Serves the pages, passes `/webgis-api/` to the API and the visit addresses to the counter |
| `nkua-webgis-api` | `postgrest/postgrest:v16.2` | Publishes the schema `api` of the database as a web API |
| `nkua-webgis-db` | `postgis/postgis:17-3.5-alpine` | PostgreSQL 17 with PostGIS 3.5; the datasets are in the schema `data` |
| `nkua-webgis-counter` | `python:3.12-alpine` | Runs `infra/counter/visit_counter.py`, which counts the visits of each site |

- The API answers under `/webgis-api/`, for example `/webgis-api/rpc/api_lagoons_count`. PostgREST
  connects as the role `webgis_authenticator` and runs every request as the role `webgis_anon`, which
  can only read, with a time limit of 5 seconds for a statement. An answer holds at most 1,000 rows.
  The functions of the schema `api` return what the pages need: counts, markers, outlines, the values
  of the filters and the details of one record.
- The web server (`infra/nginx/webgis.conf`) accepts 30 API requests a second from one visitor
  address, with a burst of 60, and 10 requests a minute for single records after a burst of 150. It
  keeps API answers in a cache for 10 minutes and marks them `noindex`.
- A page reports a visit to `/api/page-summary` (or `/<site>/api/page-summary`). The counter stores
  only the total of each site, in `/opt/nkua-webgis/visits/visits.json`; the pages state that it uses
  no cookies and collects no information that can identify a visitor. `/api/visits/summary` returns the
  totals of all the sites of the team, also of those hosted elsewhere, whose count files the counter
  reads from other folders of the server (read-only mounts in `compose.yaml`).
- On the server, a front web server that is not part of this repository ends HTTPS for
  evelpidou.nkua.cloud and historicfloods.org and passes the requests to `nkua-webgis-web` over the
  Docker network `nkua-proxy`. `infra/nginx/historicfloods.conf`, `infra/scripts/historicfloods-domain.py`
  and its systemd units add the address historicfloods.org to that server.
- The web container serves `/opt/nkua-webgis/static/current/sites` with the configuration
  `/opt/nkua-webgis/static/current/nginx.conf`, both mounted read-only. `current` points to a dated
  snapshot folder. `infra/scripts/publish-static.py` publishes changed page files as a new snapshot: it
  hard-links the previous snapshot, replaces the changed files, copies them into the source folder,
  points `current` to the new snapshot and recreates the web container. The previous snapshots are
  kept, so that a publication can be undone.
- `infra/scripts/backup.sh`, run every night by `infra/systemd/nkua-webgis-backup.timer`, writes a dump
  of the database and a copy of the visit totals to `/opt/nkua-webgis/backups` and deletes the copies
  that are more than 13 days old.

The pages load Leaflet, MapLibre GL JS, fonts and basemaps from the internet, so a visitor needs a
connection to the internet.

## Running the pages on your own computer

The pages need Python 3 for a local web server, and a connection to the internet.

```sh
git clone https://github.com/AlexandrosLiaskos/nkua-webgis
cd nkua-webgis/sites
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. The pages open with their maps and texts, but without records and
visit numbers, because the API and the data files are not part of the repository.

## Installing the service on a server

The service runs on a Linux server with Docker and Docker Compose. `compose.yaml` uses the folders of
the server under `/opt/nkua-webgis`: the clone of this repository in `/opt/nkua-webgis/src`, the
snapshots in `/opt/nkua-webgis/static` and the visit totals in `/opt/nkua-webgis/visits`.

```sh
sudo git clone https://github.com/AlexandrosLiaskos/nkua-webgis /opt/nkua-webgis/src
cd /opt/nkua-webgis/src
sudo mkdir -p /opt/nkua-webgis/static/first
sudo cp -a sites /opt/nkua-webgis/static/first/sites
sudo cp infra/nginx/webgis.conf /opt/nkua-webgis/static/first/nginx.conf
sudo ln -s first /opt/nkua-webgis/static/current
sudo bash infra/scripts/deploy.sh
```

The commands before the last one create the first snapshot that the web container serves.
`infra/scripts/deploy.sh` then does the following:

1. If `/opt/nkua-webgis/.env` does not exist, it writes the file with two random passwords, readable
   only by its owner: `POSTGRES_PASSWORD`, for the owner of the database, and `WEBGIS_API_PASSWORD`,
   for the role through which PostgREST connects. `compose.yaml` reads both from this file and refuses
   to start without them. No password is written in the repository.
2. It creates the Docker network `nkua-proxy` if it does not exist, and installs the backup timer.
3. It starts the containers with `docker compose --env-file /opt/nkua-webgis/.env -f compose.yaml up -d --build`.

When the database is created, `infra/db/001-init.sh` runs `infra/db/001-schema.sql` with `psql`. The
script creates the schemas, the roles and the API functions, gives the role `webgis_authenticator` the
password of `WEBGIS_API_PASSWORD` through the `psql` variable `authenticator_password`, and loads the
four datasets from `data/floods.jsonl`, `data/lagoons.jsonl`, `data/beachrocks.jsonl` and
`data/tombolos.jsonl`. These files are not in the repository, and without them the creation of the
database stops with an error. They are available from the research team.

After the creation, apply `20261116-dataset-protection.sql` and then
`20261116-dataset-protection-drop-views.sql` from `infra/db/releases/`. They replace the views of the
beachrock and tombolo records with functions that return markers, filter values and single records.
`001-schema.sql` already contains the function of `20261013-floods-month.sql`. The files that end in
`-rollback.sql` undo a change.

```sh
docker exec -i nkua-webgis-db psql -X --set=ON_ERROR_STOP=1 --username=webgis_owner --dbname=webgis \
  < infra/db/releases/20261116-dataset-protection.sql
```

The web container publishes no port: the front web server reaches it over the network `nkua-proxy`.
For a test without a front web server, add a port to the service `web`, for example
`ports: ["8080:80"]`.

These steps follow `infra/scripts/deploy.sh` and `compose.yaml`. An installation on a new server from
this repository has not been tested.

The release scripts of September 2026 (`infra/scripts/release-20260905.sh`,
`infra/scripts/release-floods-integration.sh`) belong to the earlier way of deploying, in which a git
bundle from a local clone was copied to the server and checked out there with `git checkout -f`. They
are kept as a record and are not used with this repository. `infra/scripts/ship.ps1`, which made and
sent those bundles, now only stops with a message: changes reach the server through `git push` and
`git pull`, and the page files are published with `infra/scripts/publish-static.py`.

## Checks

The workflow `Checks` (`.github/workflows/checks.yml`) runs on every push and pull request.

| Check | Command |
|---|---|
| Every JavaScript file parses, as an ES module where the file needs it | `node tools/checks/check_js.mjs` |
| Every JSON file parses, every HTML file is well formed, every Python file compiles and every shell script passes `bash -n` | `python3 tools/checks/check_files.py` |
| `compose.yaml` is valid | `POSTGRES_PASSWORD=x WEBGIS_API_PASSWORD=x docker compose -f compose.yaml config --quiet` |
| The history holds no secret | `gitleaks git --config .gitleaks.toml` |

The checks need Git, [Node.js](https://nodejs.org/) 22, Python 3.12, Docker Compose and
[gitleaks](https://github.com/gitleaks/gitleaks) 8.30. Run them from the root of the repository. The
HTML check accepts the end tags that HTML allows to leave out, such as those of `p`, `li` and `td`.
`.gitleaks.toml` adds to the default rules of gitleaks the names of the visit counters and of two data
fields, which the generic rule for API keys would otherwise report.

## What is not in this repository

The repository starts with the state of the source folder of the server on 16 November 2026. The
following parts of that folder were left out.

| Path | Contents | Reason |
|---|---|---|
| `data/` | The four datasets that the database loads: floods, lagoons, beachrocks, tombolos | Datasets of the research team: the sites show them, the repository does not distribute them |
| `sites/*/data/` | The data files of the sites (24,635 files, 2.1 GB): the storm events and boundaries, the other flood catalogues, the prepared files of the earthquakes, tsunamis, landslides and wildfires sites, the survey files of the Mani floods and the results of the Cyprus study | Datasets, and prepared copies of third-party data that keep the terms of their sources |
| `sites/mani-floods-2026/media/` | Photographs of the field survey (769 files, 3.1 GB) | Field-survey material of the research team |
| `sites/Κακοκαιρία-Φεβ-2026/assets/ada-pdfs/`, `assets/images/` | The decisions and images attached to the storm events (30 files) | Attachments of the records of the storm events |
| `sites/cyprus-irrigation-2026/grids/`, `layers/` | The raster layers of the study (116 files) | Results of the study |
| `sites/catalogues/` | The two catalogue sites that the builder generated, with their records and data files (3,992 files, 313 MB) | Generated pages and data |
| `sites/prisma-builder/examples/greek-coastal-storms.json` | The project file of the catalogue of coastal flooding in Greece (5 MB) | The whole catalogue as one data file |
| `sites/Κακοκαιρία-Φεβ-2026/.prisma-builder-previous-*/` | Two earlier copies of the builder | Backup copies |
| `infra/db/releases/20260905-research-expansion.sql`, its rollback, `sites/webgis-shared/research/2026-09-05/catalogue-updates.json` | Corrections of 12 records of the datasets, with the values of the records | Values of records of the datasets |
| `tools/export-public-data.ps1` | A script that downloads the datasets from the earlier public database of the lagoons site | It downloads whole datasets |
| `sites/landslides/templates/landslides-data-template.xlsx.inspect.ndjson` | A listing that a program wrote while it inspected the template | Generated file |
| `.impeccable/`, `PRODUCT.md` | Working files of a design-review tool | Not part of the sites |

The passwords of the database are in `/opt/nkua-webgis/.env` on the server, outside the folder of the
repository. The source folder of the server had a git history of 155 commits, from 4 to 5 September
2026; it is not published, because it contains the datasets. `.gitignore` keeps all these files out
of later commits.

The data submission templates in `sites/*/templates/` are included. Each CSV file holds only the names
of the columns. Each workbook holds the names of the columns and either one example row (beachrocks,
floods, lagoons, tombolos, storm events) or a field guide (earthquakes, tsunamis, landslides, wildfires,
Mani floods).

## Third-party software and services

| Software or service | Version | Licence | Use |
|---|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause | Maps of the pages, loaded from unpkg.com |
| [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | 1.5.3 | MIT | Groups of markers |
| [MapLibre GL JS](https://maplibre.org/) | 5 (the latest 5.x release) | BSD-3-Clause | Draws the vector basemap |
| [MapLibre GL Leaflet](https://github.com/maplibre/maplibre-gl-leaflet) | The latest release (0.1.4 on 16 November 2026) | ISC | Joins MapLibre GL JS to Leaflet |
| [KaTeX](https://katex.org/) | 0.16.11 | MIT | Equations on the pages of the Mani research portal |
| [nginx](https://nginx.org/) | 1.27 | BSD-2-Clause | Web server of the sites |
| [PostgreSQL](https://www.postgresql.org/) | 17 | PostgreSQL | Database |
| [PostGIS](https://postgis.net/) | 3.5 | GPL-2.0-or-later | Spatial types and functions of the database |
| [PostgREST](https://postgrest.org/) | 16.2 | MIT | Web API of the database |
| [Python](https://www.python.org/) | 3.12 | PSF-2.0 | Visit counter and tools |
| Fonts from [Google Fonts](https://fonts.google.com/): Cormorant Garamond, EB Garamond, Inter, Italianno, JetBrains Mono | | OFL-1.1 | Typefaces of the pages |
| Source Sans 3, Source Serif 4 (in `sites/prisma-builder/template-assets/fonts/`), Italianno (in `sites/floods/fonts/`) | | OFL-1.1 | Typefaces of the builder and of the floods site |
| [OpenFreeMap](https://openfreemap.org/) | | Credit: OpenFreeMap, © OpenMapTiles, data from OpenStreetMap (ODbL) | Vector basemap |
| Esri World Imagery and World Hillshade | | Terms of use of Esri | Satellite and relief basemaps |

## Citation and licence

To cite the sites, use the entry in [CITATION.cff](CITATION.cff); each site also gives its own reference
on its page.

The pages state that their original text, interface, visualisation design and research outputs are
licensed under the Creative Commons Attribution 4.0 International licence (CC BY 4.0). The code in this
repository is published under the same licence ([LICENSE](LICENSE)).

Third-party data, basemaps, imagery, logos and fonts keep their own terms, as the pages credit them.
This covers the photographs of the home page (Twelve Apostles by Alex E. Proimos, CC BY-NC 2.0;
Louisiana floods by Melissa Leake, U.S. Coast Guard, via USDA, public domain), the logos of the
university and of the partner institutions, and the software listed above. The pages of the Mani research
portal (`sites/Mani-Floods-Aug-2026/`) state their own terms: the MIT License for the software of the
portal and CC BY 4.0 for its data. The template assets of the builder
(`sites/prisma-builder/template-assets/`) carry the licence notices that the builder copies into the
catalogues it generates.

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
The changes are recorded in [CHANGELOG.md](CHANGELOG.md).
