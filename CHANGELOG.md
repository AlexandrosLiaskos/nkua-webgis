# Changelog

All notable changes to this repository are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The source code of the sites as it was on the server on 16 November 2026: the home page, twelve WebGIS
  sites and research portals, the research catalogue builder, the code that the sites share, the schema
  and the API functions of the database, the configuration of the web server, the visit counter, the
  installation, publication and backup scripts, and the programs that prepare the data files.
- `.gitignore`, which keeps the datasets, the data folders, generated catalogue sites, backup copies
  and the environment file out of the repository.
- The README, the licence (CC BY 4.0, as the pages state), the citation file, the contribution guide
  and the code of conduct.
- The workflow `Checks`: the syntax of the JavaScript, JSON, Python and shell files, the
  well-formedness of the HTML files, the compose file, and a secret scan with gitleaks.

- The model code of the Mani research portal (`sites/Mani-Floods-Aug-2026/src/`), copied from the
  live site without its data files, the archive of the code and one helper script.

### Changed

- `infra/nginx/webgis.conf` answers counting requests (POST) to the page-summary addresses and to
  `/api/visits/` with 204, without passing them to the counter, when the user agent names a robot, an
  automation tool or an HTTP library, or is empty. Reading the numbers (GET) is not affected.
- `infra/counter/visit_counter.py` lists the Nepal data resources catalogue and the Evelpidou site as
  comparable again: their counters were corrected on 17 November 2026 to the visits of people measured in
  the front web server's log, and their web servers now leave out robots and cloud networks. The general
  note says which counters leave out automated requests.
- `infra/counter/visit_counter.py` gives the Nepal data resources catalogue and the Evelpidou site the
  note "The figure before 17 Nov 2026 includes automated access; since then automated access is
  filtered." (new `SITE_NOTES`; the note appears only in the API answer). On 17 November 2026, at the
  owner's decision, both counters were set back to their earlier figures plus the visits counted since
  the correction (12,097 and 1,210); both stay comparable, and their web servers keep leaving out robots
  and cloud networks. The general note no longer says that their numbers were corrected.
- `infra/scripts/ship.ps1` stops with a message instead of copying a git bundle to the server and
  forcing a checkout there.

### Changed

- `compose.yaml` stops the visit counter with SIGINT. `visit_counter.py` runs as PID 1 without a
  SIGTERM handler, so it ignored the default stop signal and was killed after 10 seconds.
- `infra/nginx/webgis.conf` looks the visit counter up through the resolver also for the
  `/api/page-summary` addresses of the pages, as it already did for `/api/visits/`, so a recreated
  counter is found without reloading nginx.
- `infra/nginx/webgis.conf` takes the address of the visitor from the `X-Forwarded-For` header that
  the front web server writes, and trusts only that server for it (`set_real_ip_from`,
  `real_ip_header`, `real_ip_recursive`). The limits of the page counters and of the API that use
  `$binary_remote_addr` now count each visitor; before, all visitors counted as the front server.
  The limit for one-record requests already used the visitor address and is unchanged.
- Twelve scripts of the Mani model code in `sites/Mani-Floods-Aug-2026/src/src/pipeline/` no longer
  name folders of one computer. They read the project folder from the environment variable
  `MANI_PROJECT_ROOT`, the folder for a second copy of the figures from `MANI_FIGURE_COPY_DIR`, the
  working folder of the figures from `MANI_SCRATCH_DIR` and the geodatabase of the field photographs
  from `MANI_PHOTO_GDB`. Without these variables they use the folder that holds the code and its
  subfolders `figures/`, `scratch/` and `data/photographs/`.
- The home page is named 'Collections of Geodatasets'. The name replaces 'Geospatial research
  catalogues — NKUA' and 'NKUA geospatial research catalogues' in the title of `sites/index.html`,
  its description, the titles and image descriptions for link previews, the structured data, the web
  manifest (short name 'Geodatasets') and the share dialog of `sites/geocollections.js`.
- `infra/counter/visit_counter.py`: the visit summary names the home page 'Collections of
  Geodatasets' and the four hazard pages by their page titles, 'Earthquakes of Earth', 'Tsunamis of
  Earth', 'Landslides of Earth' and 'Wildfires of Earth' (before: 'Earthquakes WebGIS' and so on).
- The pages name their own address and the addresses of their own files on
  `https://evelpidou.nkua.cloud`, which answers directly. The former host name of the collection
  answers with a redirect, and it stood in the canonical links, the addresses and images for link
  previews, the structured data, the share links, the suggested citations and the links to the data
  templates of ten pages and three scripts. `sites/index.html` loads the script as
  `geocollections.js?v=20261117-host-1`. `sites/floods/` keeps `https://historicfloods.org/` as its
  canonical address.

### Fixed

- The 'Map credits' button of the eleven WebGIS sites that load `sites/webgis-shared/lagoons-ui.css`
  opens the basemap credits again. In windows wider than 720 px the right box of the status bar
  covered the button, so the button now sits above that box. In windows up to 768 px wide the map
  container was taller than the space between the header and the footer, and the status bar and the
  button lay outside the visible area; the map container now takes the height of that space. The
  pages load the file as `lagoons-ui.css?v=20261117-credits-1`.

### Earlier history

The sites were developed in a git repository on the server from 4 September 2026 (155 commits). That
history is not published, because it contains the datasets.
