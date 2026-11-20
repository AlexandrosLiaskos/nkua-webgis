from __future__ import annotations

import argparse
import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


# WebGIS pages served by this project. Each has its own address
# /<site>/api/page-summary, which nginx maps to /api/visit/<site>.
# infra/scripts/publish-static.py adds new names to this set; keep the line.
SUPPORTED_SITES = frozenset({"cyprus-irrigation-2026", "mani-floods-2026", "wildfires", "earthquakes", "tsunamis", "landslides", "beachrocks", "floods", "geocollections", "lagoons", "storm", "tombolos"})

EVELPIDOU = "https://evelpidou.nkua.cloud"
GITHUB_PAGES_PERSONAL = "https://alexandrosliaskos.github.io"
GITHUB_PAGES_TEAM = "https://uoa-gr.github.io"

# Name and public address of every site in the summary, in the order of the list.
# A WebGIS page that is missing here is listed under its key.
SITE_DETAILS: dict[str, tuple[str, str]] = {
    "geocollections": ("Collections of Geodatasets", f"{EVELPIDOU}/"),
    "storm": ("February 2026 Storm Surges WebGIS", f"{EVELPIDOU}/%CE%9A%CE%B1%CE%BA%CE%BF%CE%BA%CE%B1%CE%B9%CF%81%CE%AF%CE%B1-%CE%A6%CE%B5%CE%B2-2026/"),
    "floods": ("Historic Floods of Earth WebGIS", "https://historicfloods.org/"),
    "naxos": ("Geomorphological Map of Naxos WebGIS", f"{GITHUB_PAGES_TEAM}/naxos/"),
    "beachrocks": ("Beach Rocks WebGIS", f"{EVELPIDOU}/beachrocks/"),
    "tombolos": ("Tombolo WebGIS", f"{EVELPIDOU}/tombolos/"),
    "lagoons": ("Coastal Lagoons of Earth WebGIS", f"{EVELPIDOU}/lagoons/"),
    "nepal-flood-2026": ("2026 Nepal Cascade Hazard WebGIS", f"{EVELPIDOU}/Nepal-Flood-2026/"),
    "nepal-flood-2026-catalogue": ("Public Data Resources for the 26 August 2026 Nepal Hazard Cascade", f"{EVELPIDOU}/Nepal-Flood-2026-Catalogue/"),
    "earthquakes": ("Earthquakes of Earth", f"{EVELPIDOU}/earthquakes/"),
    "tsunamis": ("Tsunamis of Earth", f"{EVELPIDOU}/tsunamis/"),
    "landslides": ("Landslides of Earth", f"{EVELPIDOU}/landslides/"),
    "wildfires": ("Wildfires of Earth", f"{EVELPIDOU}/wildfires/"),
    "mani-floods-2026": ("Floods in Mani, Greece, 15 August 2026", f"{EVELPIDOU}/mani-floods-2026/"),
    "mani-floods-aug-2026": ("Mani Peninsula Flash Flood Reconstruction, Research Portal", f"{EVELPIDOU}/Mani-Floods-Aug-2026/"),
    "cyprus-irrigation-2026": ("Κατανάλωση νερού άρδευσης στην Κύπρο 2018–2026", f"{EVELPIDOU}/cyprus-irrigation-2026/"),
    "prisma-builder": ("Research catalogue builder", f"{EVELPIDOU}/prisma-builder/"),
    "catalogue-greek-coastal-storms": ("Coastal flooding in Greece, February 2026 (research catalogue)", f"{EVELPIDOU}/catalogues/greek-coastal-storms/"),
    "catalogue-new-study": ("New research catalogue", f"{EVELPIDOU}/catalogues/new-study/"),
    "ancient-greek-wonders": ("Wonders of the Ancient Greek World WebGIS", f"{GITHUB_PAGES_PERSONAL}/Ancient-Greek-Wonders/"),
    "ancient-greek-world-atlas": ("Άτλας του Αρχαίου Ελληνικού Κόσμου", f"{GITHUB_PAGES_PERSONAL}/ancient-greek-world-atlas/"),
    "cvic": ("CVIc", f"{GITHUB_PAGES_PERSONAL}/CVIc/"),
    "webgis-builder": ("WebGIS Builder", "https://webgis.nkua.cloud/"),
    "lynkeus": ("Lynkeus", "https://lynkeus.nkua.cloud/"),
    "hgs": ("Hellenic Geographical Society (HGS)", "https://hellenic-geographical-society.com/"),
    "denuchange": ("5th International IAG DENUCHANGE Workshop", f"{GITHUB_PAGES_TEAM}/denuchange/"),
    "evelpidou": ("Prof. Niki Evelpidou", f"{EVELPIDOU}/evelpidou/"),
    "geological-museum-apeiranthos": ("Geological Museum of Apeiranthos", f"{GITHUB_PAGES_TEAM}/geological-museum-apeiranthos/"),
    "exp-dunes-naxos": ("Artificially Triggered Nature-based Sand Dunes Visitor Guide", f"{GITHUB_PAGES_TEAM}/exp-dunes-naxos/"),
    "msc-gis": ("Master's Programme in Geographic Information Systems", "https://gis.geol.uoa.gr/"),
    "liaskos-eu": ("Alexandros P. Liaskos", "https://liaskos.eu/"),
    "science-trees": ("The trees of science", "https://liaskos.nkua.cloud/trees/"),
    "jazz-ink": ("Jazz Ink", "https://liaskos.nkua.cloud/jazz/"),
}

# Sites that record a visit with POST /api/visits/<key>. The request is accepted
# only when its Origin header is one of the origins listed for the key.
RECORDING_ORIGINS: dict[str, frozenset[str]] = {
    "naxos": frozenset({GITHUB_PAGES_TEAM}),
    "exp-dunes-naxos": frozenset({GITHUB_PAGES_TEAM}),
    "denuchange": frozenset({GITHUB_PAGES_TEAM, "https://denuchange.vercel.app"}),
    "cvic": frozenset({GITHUB_PAGES_PERSONAL}),
    "ancient-greek-world-atlas": frozenset({GITHUB_PAGES_PERSONAL}),
    "ancient-greek-wonders": frozenset({GITHUB_PAGES_PERSONAL}),
    "hgs": frozenset({"https://hellenic-geographical-society.com", "https://www.hellenic-geographical-society.com"}),
    # The English and the Greek address of the programme share one count.
    "msc-gis": frozenset({"https://gis.geol.uoa.gr", "https://gis-el.geol.uoa.gr"}),
    "liaskos-eu": frozenset({"https://liaskos.eu", "https://www.liaskos.eu"}),
    "mani-floods-aug-2026": frozenset({EVELPIDOU}),
    "prisma-builder": frozenset({EVELPIDOU}),
    "catalogue-greek-coastal-storms": frozenset({EVELPIDOU}),
    "catalogue-new-study": frozenset({EVELPIDOU}),
    "science-trees": frozenset({"https://liaskos.nkua.cloud"}),
    "jazz-ink": frozenset({"https://liaskos.nkua.cloud"}),
}

# Counters kept by other projects on this server. They are read, never written:
# a file is a read-only mount of the project's own count file, an address is
# the project's own public count. The value is {"count": <integer>}.
LINKED_COUNTERS: dict[str, str] = {
    "evelpidou": "/app/linked/evelpidou/visits.json",
    "nepal-flood-2026": "/app/linked/nepal-flood-2026/visits.json",
    "nepal-flood-2026-catalogue": "/app/linked/nepal-flood-2026-catalogue/visits.json",
    "geological-museum-apeiranthos": "/app/linked/geological-museum-apeiranthos/visits.json",
    "ancient-greek-wonders": "/app/linked/ancient-greek-wonders/visits.json",
    "lynkeus": "/app/linked/lynkeus/visits.json",
    "webgis-builder": "http://nkua-webgis-web:8081/linked/webgis-builder",
}

# Sites whose number is not a count of one visit per browser session of that site.
# They are listed with "comparable": false and the reason, and are left out of "total".
NOT_COMPARABLE: dict[str, str] = {}

# Notes on sites whose number is comparable but includes automated access recorded before the filters
# of 17 November 2026 (their earlier figures were kept at the owner's decision). The notes appear only in
# the API answer; the pages do not show them.
AUTOMATED_BEFORE_FILTER = "The figure before 17 Nov 2026 includes automated access; since then automated access is filtered."
SITE_NOTES: dict[str, str] = {
    "nepal-flood-2026-catalogue": AUTOMATED_BEFORE_FILTER,
    "evelpidou": AUTOMATED_BEFORE_FILTER,
}

SUMMARY_NOTE = (
    "Each number is the total recorded by the counter of the site itself: a script on the page adds one visit "
    "per browser session. Since 17 November 2026 the web servers do not count requests from self-identified "
    "robots and automation tools, except those of Lynkeus, the 2026 Nepal Cascade Hazard WebGIS and the WebGIS "
    "Builder, and the Nepal data resources catalogue and the site of Prof. Niki Evelpidou also leave out requests "
    "from cloud and hosting networks. The numbers recorded before that date include automated visits. No "
    "cookies are used and the counters store only the totals. "
    "\"total\" is the sum of the sites with \"comparable\": true; \"total_all\" also includes the sites whose "
    "number is not comparable."
)

SUMMARY_LIFETIME_SECONDS = 60
LINKED_ADDRESS_LIFETIME_SECONDS = 60
LINKED_ADDRESS_TIMEOUT_SECONDS = 2


class VisitCounter:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()

    def _read_unlocked(self) -> dict[str, int]:
        counts = {site: 0 for site in SUPPORTED_SITES | RECORDING_ORIGINS.keys()}
        if not self.path.exists():
            return counts
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        # Keys that this version does not know stay in the file unchanged.
        for site, value in payload.items():
            counts[str(site)] = max(0, int(value))
        return counts

    def current(self, site: str) -> int:
        with self.lock:
            return self._read_unlocked()[site]

    def all(self) -> dict[str, int]:
        with self.lock:
            return self._read_unlocked()

    def increment(self, site: str) -> int:
        with self.lock:
            counts = self._read_unlocked()
            counts[site] += 1
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
            with temporary_path.open("w", encoding="utf-8") as handle:
                handle.write(json.dumps(counts, separators=(",", ":"), sort_keys=True))
                handle.flush()
                os.fsync(handle.fileno())
            temporary_path.replace(self.path)
            return counts[site]


class LinkedCounters:
    """Counts kept by other projects. The last value that could be read is kept in memory and used when a source cannot be read."""

    def __init__(self, sources: dict[str, str]) -> None:
        self.sources = sources
        self.lock = threading.Lock()
        self.last_known: dict[str, int] = {}
        self.address_read_at: dict[str, float] = {}

    @staticmethod
    def _count_from(text: str) -> int:
        count = int(json.loads(text)["count"])
        if count < 0:
            raise ValueError("negative count")
        return count

    def _read_file(self, source: str) -> int:
        path = Path(source)
        if not path.exists():
            if path.parent.is_dir():
                return 0  # The project has not recorded a visit yet.
            raise OSError("count folder is not available")
        return self._count_from(path.read_text(encoding="utf-8"))

    def _read_address(self, source: str) -> int:
        request = urllib.request.Request(source, headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=LINKED_ADDRESS_TIMEOUT_SECONDS) as response:
            return self._count_from(response.read(4096).decode("utf-8"))

    def current(self, site: str) -> int:
        source = self.sources.get(site)
        if source is None:
            return 0
        is_address = source.startswith("http://") or source.startswith("https://")
        with self.lock:
            if is_address and time.monotonic() - self.address_read_at.get(site, float("-inf")) < LINKED_ADDRESS_LIFETIME_SECONDS:
                return self.last_known.get(site, 0)
            try:
                count = self._read_address(source) if is_address else self._read_file(source)
            except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
                count = self.last_known.get(site, 0)
            else:
                self.last_known[site] = count
            if is_address:
                self.address_read_at[site] = time.monotonic()
            return count


class VisitRequestHandler(BaseHTTPRequestHandler):
    server_version = "NKUAWebGISVisitCounter/2.0"

    def __init__(self, *args, counter: VisitCounter, linked: LinkedCounters, **kwargs) -> None:
        self.counter = counter
        self.linked = linked
        super().__init__(*args, **kwargs)

    # The address of one WebGIS page of this project: /api/visit/<site>.

    @staticmethod
    def _site_from_path(path: str) -> str | None:
        prefix = "/api/visit/"
        if not path.startswith(prefix):
            return None
        site = path.removeprefix(prefix)
        return site if site in SUPPORTED_SITES else None

    # The summary and the addresses of all sites: /api/visits/summary and /api/visits/<key>.

    @staticmethod
    def _key_from_path(path: str) -> str | None:
        prefix = "/api/visits/"
        if not path.startswith(prefix):
            return None
        return path.removeprefix(prefix)

    @staticmethod
    def _known_keys() -> list[str]:
        keys = list(SITE_DETAILS)
        known = set(keys)
        for site in sorted(SUPPORTED_SITES | RECORDING_ORIGINS.keys() | LINKED_COUNTERS.keys()):
            if site not in known:
                keys.append(site)
        return keys

    def _visits(self, key: str, counts: dict[str, int]) -> int:
        return counts.get(key, 0) + self.linked.current(key)

    def _summary(self) -> dict[str, object]:
        counts = self.counter.all()
        sites: dict[str, dict[str, object]] = {}
        for key in self._known_keys():
            visits = self._visits(key, counts)
            # A site that records through POST is listed from its first recorded visit.
            if visits == 0 and key in RECORDING_ORIGINS and key not in SUPPORTED_SITES and key not in LINKED_COUNTERS:
                continue
            name, url = SITE_DETAILS.get(key, (key, f"{EVELPIDOU}/{key}/"))
            entry: dict[str, object] = {"name": name, "url": url, "visits": visits, "comparable": key not in NOT_COMPARABLE}
            if key in NOT_COMPARABLE:
                entry["note"] = NOT_COMPARABLE[key]
            elif key in SITE_NOTES:
                entry["note"] = SITE_NOTES[key]
            sites[key] = entry
        return {
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total": sum(int(entry["visits"]) for entry in sites.values() if entry["comparable"]),
            "total_all": sum(int(entry["visits"]) for entry in sites.values()),
            "sites": sites,
            "note": SUMMARY_NOTE,
        }

    def _allowed_origin(self, key: str) -> str | None:
        origin = self.headers.get("Origin", "")
        return origin if origin in RECORDING_ORIGINS.get(key, frozenset()) else None

    def _cors_headers(self, key: str) -> dict[str, str]:
        headers = {"Vary": "Origin"}
        origin = self._allowed_origin(key)
        if origin:
            headers["Access-Control-Allow-Origin"] = origin
        return headers

    def do_GET(self) -> None:
        self._read(send_body=True)

    def do_HEAD(self) -> None:
        self._read(send_body=False)

    def _read(self, *, send_body: bool) -> None:
        parsed_path = urlparse(self.path).path
        if parsed_path == "/healthz":
            self._send_json({"status": "ok"}, send_body=send_body)
            return
        if parsed_path == "/api/visits/summary":
            try:
                summary = self._summary()
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                self._send_json({"error": "Visit summary unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE, send_body=send_body)
                return
            self._send_json(
                summary,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": f"public, max-age={SUMMARY_LIFETIME_SECONDS}",
                },
                send_body=send_body,
            )
            return
        key = self._key_from_path(parsed_path)
        if key is not None:
            if key not in self._known_keys():
                self._send_json({"error": "Unknown site"}, HTTPStatus.NOT_FOUND, send_body=send_body)
                return
            try:
                count = self._visits(key, self.counter.all())
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                self._send_json({"error": "Visit count unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE, headers=self._cors_headers(key), send_body=send_body)
                return
            self._send_json({"count": count, "metric": "recorded_page_visits", "site": key}, headers=self._cors_headers(key), send_body=send_body)
            return
        site = self._site_from_path(parsed_path)
        if site is None:
            self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND, send_body=send_body)
            return
        self._send_count(site, increment=False, send_body=send_body)

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length:
            self.rfile.read(content_length)
        parsed_path = urlparse(self.path).path
        key = self._key_from_path(parsed_path)
        if key is not None:
            self._record(key)
            return
        site = self._site_from_path(parsed_path)
        if site is None:
            self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        self._send_count(site, increment=True)

    def _record(self, key: str) -> None:
        if key == "summary":
            self._send_json({"error": "Method not allowed"}, HTTPStatus.METHOD_NOT_ALLOWED, headers={"Allow": "GET, HEAD"})
            return
        if key not in self._known_keys():
            self._send_json({"error": "Unknown site"}, HTTPStatus.NOT_FOUND)
            return
        if key not in RECORDING_ORIGINS:
            # The site has its own counter address; this one only reads its number.
            self._send_json({"error": "Method not allowed"}, HTTPStatus.METHOD_NOT_ALLOWED, headers={"Allow": "GET, HEAD"})
            return
        if self._allowed_origin(key) is None:
            self._send_json({"error": "Origin not allowed"}, HTTPStatus.FORBIDDEN, headers={"Vary": "Origin"})
            return
        try:
            self.counter.increment(key)
            count = self._visits(key, self.counter.all())
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._send_json({"error": "Visit count unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE, headers=self._cors_headers(key))
            return
        self._send_json({"count": count, "metric": "recorded_page_visits", "site": key}, headers=self._cors_headers(key))

    def do_OPTIONS(self) -> None:
        key = self._key_from_path(urlparse(self.path).path)
        origin = self._allowed_origin(key) if key is not None else None
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Vary", "Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Accept")
            self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_count(self, site: str, *, increment: bool, send_body: bool = True) -> None:
        try:
            count = self.counter.increment(site) if increment else self.counter.current(site)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._send_json({"error": "Visit count unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE, send_body=send_body)
            return
        self._send_json({"count": count, "metric": "recorded_page_visits", "site": site}, send_body=send_body)

    def _send_json(
        self,
        payload: dict[str, object],
        status: HTTPStatus = HTTPStatus.OK,
        *,
        headers: dict[str, str] | None = None,
        send_body: bool = True,
    ) -> None:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        all_headers = {"Cache-Control": "no-store"}
        all_headers.update(headers or {})
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in all_headers.items():
            self.send_header(name, value)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve aggregate visit counts for NKUA WebGIS pages and the visit summary of all sites.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--count-file", type=Path, required=True)
    arguments = parser.parse_args()

    counter = VisitCounter(arguments.count_file.resolve())
    linked = LinkedCounters(LINKED_COUNTERS)
    handler = partial(VisitRequestHandler, counter=counter, linked=linked)
    server = ReusableThreadingHTTPServer((arguments.host, arguments.port), handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
