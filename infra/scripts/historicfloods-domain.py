#!/usr/bin/env python3
"""Publish aliases of the existing flood WebGIS and enable TLS after DNS changes."""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

DOMAINS = ("historicfloods.org", "www.historicfloods.org")
VPS_IP = "76.13.133.211"
SOURCE = Path("/opt/nkua-webgis/src")
TEMPLATE = Path("/opt/coms/src/infra/nginx/nginx.prod.conf")
SNIPPET = Path("/etc/letsencrypt/nginx/historicfloods.conf")
SOURCE_SNIPPET = SOURCE / "infra/nginx/historicfloods.conf"
STATE = Path("/opt/nkua-webgis/historicfloods-domain")
BACKUP = Path("/opt/nkua-webgis/backups/20261004-historicfloods-domain")
INCLUDE = "  include /etc/letsencrypt/nginx/historicfloods.conf;\n"
CONTAINER = "coms-nginx-1"
CERT = Path("/etc/letsencrypt/live/historicfloods.org/fullchain.pem")


def run(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, text=True, **kwargs)


def atomic_write(path: Path, value: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".pending")
    temporary.write_text(value, encoding="utf-8")
    temporary.chmod(mode)
    temporary.replace(path)


def proxy_routes() -> str:
    # Relative flood URLs map to the original /floods/ deployment. The root
    # /api/page-summary therefore reaches /api/visit/floods, never geocollections.
    # These shared paths are existing imports/images, not separate deployments.
    return """    set $historic_floods_app http://nkua-webgis-web:80;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_redirect off;

    location ~ ^/(?:floods(?:/|$)|webgis-shared/|webgis-api/|lagoons/js/|team/) {
      proxy_pass $historic_floods_app;
    }

    location / {
      rewrite ^/(.*)$ /floods/$1 break;
      proxy_pass $historic_floods_app;
    }
"""


def config(tls: bool) -> str:
    http_body = "    location / { return 308 https://$host$request_uri; }\n" if tls else proxy_routes()
    result = """# One flood application, data service and visit total across all hostnames.
# Managed by infra/scripts/historicfloods-domain.py; included inside http {}.
  server {
    listen 80;
    listen [::]:80;
    server_name historicfloods.org www.historicfloods.org;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location ^~ /.well-known/acme-challenge/ {
      root /var/www/certbot;
      default_type text/plain;
    }
""" + http_body + "  }\n"
    if tls:
        result += """
  server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name historicfloods.org www.historicfloods.org;
    ssl_certificate /etc/letsencrypt/live/historicfloods.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/historicfloods.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
""" + proxy_routes() + "  }\n"
    return result


def render_and_reload() -> None:
    # The entrypoint substitutes only the existing signing secret. It is never
    # emitted or copied into our source/snippet/logs.
    run("docker", "exec", CONTAINER, "/docker-entrypoint.d/20-envsubst-on-templates.sh", stdout=subprocess.DEVNULL)
    run("docker", "exec", CONTAINER, "nginx", "-t")
    run("docker", "exec", CONTAINER, "nginx", "-s", "reload")


def write_routes(tls: bool) -> None:
    previous = SNIPPET.read_text() if SNIPPET.exists() else None
    value = config(tls)
    if previous == value:
        atomic_write(SOURCE_SNIPPET, value)
        return
    atomic_write(SNIPPET, value)
    try:
        render_and_reload()
    except Exception:
        if previous is not None:
            atomic_write(SNIPPET, previous)
            render_and_reload()
        raise
    atomic_write(SOURCE_SNIPPET, value)


def install() -> None:
    original = TEMPLATE.read_text()
    if INCLUDE not in original:
        # Avoid replacing another unrendered proxy change. cmp prints no secrets.
        check = subprocess.run(
            ["docker", "exec", CONTAINER, "sh", "-c",
             "envsubst '${DOWNLOAD_SIGNING_SECRET}' < /etc/nginx/templates/nginx.conf.template | cmp -s - /etc/nginx/nginx.conf"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if check.returncode:
            raise RuntimeError("Proxy source and active config differ; preserve and reconcile before installing")
        if original.count("http {\n") != 1:
            raise RuntimeError("Expected one outer nginx http block")
        BACKUP.mkdir(parents=True, exist_ok=True)
        shutil.copy2(TEMPLATE, BACKUP / "nginx.prod.conf")
        atomic_write(SNIPPET, config(CERT.exists()))
        # This template is a single-file bind mount; keep its inode so both the
        # running container and subsequent deployments see this small addition.
        TEMPLATE.write_text(original.replace("http {\n", "http {\n" + INCLUDE, 1))
        try:
            render_and_reload()
        except Exception:
            TEMPLATE.write_text(original)
            render_and_reload()
            raise
    write_routes(CERT.exists())
    STATE.mkdir(parents=True, exist_ok=True)
    atomic_write(SOURCE / "infra/systemd/historicfloods-domain.service", SERVICE)
    atomic_write(SOURCE / "infra/systemd/historicfloods-domain.timer", TIMER)
    atomic_write(Path("/etc/systemd/system/historicfloods-domain.service"), SERVICE)
    atomic_write(Path("/etc/systemd/system/historicfloods-domain.timer"), TIMER)
    run("systemctl", "daemon-reload")
    run("systemctl", "enable", "--now", "historicfloods-domain.timer")
    print("Domain routing installed; DNS-gated automatic HTTPS activation enabled.")


def dns_addresses(domain: str, record: str, resolver: str) -> set[str]:
    result = run("dig", "+time=2", "+tries=1", "@" + resolver, "+short", record, domain, capture_output=True)
    values = set()
    for line in result.stdout.splitlines():
        try:
            address = ipaddress.ip_address(line.strip())
        except ValueError:
            continue  # CNAME targets are also included by dig +short.
        if (record == "A" and address.version == 4) or (record == "AAAA" and address.version == 6):
            values.add(str(address))
    return values


def activate() -> None:
    if CERT.exists():
        write_routes(True)
        atomic_write(STATE / "status.json", json.dumps({"status": "https_active", "domains": DOMAINS}) + "\n")
        run("systemctl", "disable", "--now", "historicfloods-domain.timer")
        print("HTTPS active for both flood domains; normal Certbot renewal applies.")
        return
    for resolver in ("1.1.1.1", "8.8.8.8"):
        for domain in DOMAINS:
            if dns_addresses(domain, "A", resolver) != {VPS_IP} or dns_addresses(domain, "AAAA", resolver):
                atomic_write(STATE / "status.json", json.dumps({"status": "waiting_for_dns", "domain": domain, "ipv4": VPS_IP}) + "\n")
                print(f"Waiting for {domain} DNS to point only to {VPS_IP}.")
                return
    attempt = STATE / "last-certificate-attempt"
    if attempt.exists() and time.time() - float(attempt.read_text()) < 3600:
        print("Certificate attempt cooldown; will retry automatically.")
        return
    atomic_write(attempt, str(time.time()))
    args = ["certbot", "certonly", "--non-interactive", "--agree-tos", "--webroot", "-w", "/var/www/certbot",
            "--cert-name", DOMAINS[0], "-d", DOMAINS[0], "-d", DOMAINS[1]]
    renewal = Path("/etc/letsencrypt/renewal/evelpidou.nkua.cloud.conf").read_text()
    account = re.search(r"^account\s*=\s*(\w+)\s*$", renewal, re.MULTILINE)
    if account:
        args.extend(["--account", account.group(1)])
    run(*args, timeout=180)
    activate()


SERVICE = """[Unit]
Description=Activate historicfloods.org HTTPS after DNS points to the VPS
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/nkua-webgis/src/infra/scripts/historicfloods-domain.py --activate
TimeoutStartSec=240
"""

TIMER = """[Unit]
Description=Wait for Historic Floods DNS and activate HTTPS once

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=historicfloods-domain.service

[Install]
WantedBy=timers.target
"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--activate", action="store_true")
    options = parser.parse_args()
    if options.install:
        install()
    elif options.activate:
        activate()
    else:
        parser.error("Choose --install or --activate")
