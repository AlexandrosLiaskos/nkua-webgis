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

- `infra/scripts/ship.ps1` stops with a message instead of copying a git bundle to the server and
  forcing a checkout there.

### Changed

- `compose.yaml` stops the visit counter with SIGINT. `visit_counter.py` runs as PID 1 without a
  SIGTERM handler, so it ignored the default stop signal and was killed after 10 seconds.
- `infra/nginx/webgis.conf` looks the visit counter up through the resolver also for the
  `/api/page-summary` addresses of the pages, as it already did for `/api/visits/`, so a recreated
  counter is found without reloading nginx.
- Twelve scripts of the Mani model code in `sites/Mani-Floods-Aug-2026/src/src/pipeline/` no longer
  name folders of one computer. They read the project folder from the environment variable
  `MANI_PROJECT_ROOT`, the folder for a second copy of the figures from `MANI_FIGURE_COPY_DIR`, the
  working folder of the figures from `MANI_SCRATCH_DIR` and the geodatabase of the field photographs
  from `MANI_PHOTO_GDB`. Without these variables they use the folder that holds the code and its
  subfolders `figures/`, `scratch/` and `data/photographs/`.

### Earlier history

The sites were developed in a git repository on the server from 4 September 2026 (155 commits). That
history is not published, because it contains the datasets.
