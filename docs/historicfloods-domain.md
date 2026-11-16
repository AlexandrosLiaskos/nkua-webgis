# Historic Floods domain setup

The same VPS application serves:

- https://historicfloods.org/
- https://www.historicfloods.org/
- https://evelpidou.nkua.cloud/floods/

All use the existing flood site files, data services, and the `floods` visit total
in `/opt/nkua-webgis/visits/visits.json`. Future flood-site publications apply to
every address. Session-storage visit suppression is per browser origin; this
is a shared page-visit total, not cross-domain unique-person tracking.

## Hostinger

Keep the current nameservers:

- `ns1.dns-parking.com`
- `ns2.dns-parking.com`

Open **Domains → Domain portfolio → historicfloods.org → Manage →
DNS/Nameservers → DNS records**.

Replace the four existing `@` A records pointing to GitHub Pages
(`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`)
with one record:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | @ | 76.13.133.211 | 300, or the default |
| CNAME | www | historicfloods.org | 300, or the default |

Edit the existing `www` CNAME that points to `alexandrosliaskos.github.io`.
Use only one `www` CNAME. If there are A or AAAA records for `www`, remove
those conflicting records. There were no apex AAAA records when inspected;
do not add an AAAA unless IPv6 hosting is configured separately.

Keep mail (MX), verification (TXT), and unrelated DNS records. No change is
needed to `evelpidou.nkua.cloud`.

Hostinger's current instructions:
https://www.hostinger.com/tutorials/how-to-point-domain-to-vps/

## HTTPS and operations

The VPS is already configured for both domain hostnames over HTTP, including
the ACME webroot. A systemd timer checks public DNS every five minutes. Once
both names point only to this VPS IPv4 and have no conflicting IPv6 records,
it obtains a Let's Encrypt certificate and enables HTTPS for both names.
HTTP then redirects to the matching HTTPS hostname. All three HTTPS addresses
remain usable and the existing URL is preserved.

DNS caches may retain the old values for up to 24 hours. Existing records had
a TTL of 3600 seconds when inspected. The HTTPS activation timer disables
itself after success; the existing Certbot renewal process renews the certificate.

Source files:

- `/opt/nkua-webgis/src/infra/scripts/historicfloods-domain.py`
- `/opt/nkua-webgis/src/infra/nginx/historicfloods.conf`
- `/opt/nkua-webgis/src/infra/systemd/historicfloods-domain.service`
- `/opt/nkua-webgis/src/infra/systemd/historicfloods-domain.timer`

The shared proxy includes `/etc/letsencrypt/nginx/historicfloods.conf` inside
its `http` block. No separate site container or counter was created.

Status and manual activation:

```sh
cat /opt/nkua-webgis/historicfloods-domain/status.json
systemctl status historicfloods-domain.timer historicfloods-domain.service
journalctl -u historicfloods-domain.service -n 30 --no-pager
python3 /opt/nkua-webgis/src/infra/scripts/historicfloods-domain.py --activate
```

Backup of the previous proxy source and flood HTML metadata:
`/opt/nkua-webgis/backups/20261004-historicfloods-domain/`.
