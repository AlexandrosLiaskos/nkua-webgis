# Contributing

Contributions are welcome through pull requests. A pull request is merged when the checks of the
workflow `Checks` have passed.

## Licence

Contributions are accepted under the licence of the repository, the Creative Commons Attribution 4.0
International licence (CC BY 4.0).

## Datasets

The repository holds code, page files and documentation, never datasets. The sites show the datasets
of the research team, but no file of the repository may hold a whole dataset or a program that
downloads one.

- Do not add data files or data folders. `.gitignore` lists the kinds of files that are kept out, and a
  change to `.gitignore` that lets data in is not accepted.
- A change that needs new or corrected data describes it in the pull request. The data are loaded on
  the server, not committed.
- The data submission templates in `sites/*/templates/` hold only the names of the columns, and at
  most one example row.

## Secrets

Passwords and keys are never written in a file of the repository. The passwords of the database are
in `/opt/nkua-webgis/.env` on the server, and `compose.yaml` reads them from there. The workflow scans
every commit with gitleaks.

## Code

- The pages are HTML, CSS and JavaScript without a build step. Code that more than one site uses goes
  into `sites/webgis-shared/`.
- A page loads its scripts with a version in the address, for example
  `./js/main.js?v=20261026-filters-display-1`. Change the version when the file changes, so that
  browsers load the new file.
- The text of the pages is plain and literal, in the language of the page.
- Run the checks listed in [README.md](README.md) before opening a pull request.

## Publication

A merged change reaches the live sites only when the maintainer publishes it on the server with
`infra/scripts/publish-static.py`.
