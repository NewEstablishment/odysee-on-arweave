# Analytics

This repository contains the HyperBEAM package for `analytics@1.0`, a
web page analytics tool.

It lets a wallet register an HTML app, receive a public tracking key, embed a
small script tag, invite additional wallet addresses to view a tracker, and see
visits/durations/demographics in the bundled dashboard. Tracking pings do not
use browser storage.

## What It Measures

- daily anonymous page-load visits
- active duration per visit
- average duration
- active visits seen recently
- page pathname breakdowns
- IP address breakdowns
- location breakdowns from CDN/proxy geo headers when available

The device deliberately does not store user agents, referrers, cookies,
localStorage, sessionStorage, IndexedDB, or fingerprint material. It does store
the visitor IP reported by common proxy headers and best-effort location fields
from common CDN/edge geo headers. Reported "users" are still page-load visits,
not cross-session deduplicated people.

## Register A Site

Open the dashboard:

```text
/~analytics@1.0/index
```

Connect an Arweave wallet, register a site, and copy the returned snippet into
your site's HTML:

```html
<script async src="https://your-node.example/~analytics@1.0/script?key=TRACKING_KEY"></script>
```

The `src` must be an **absolute** URL pointing at the HyperBEAM node that runs
this device (e.g. `http://localhost:8734/...` when developing locally, or your
node's public origin in production) — not a root-relative `/~analytics@1.0/...`
path, which a browser would resolve against the tracked site's own domain. The
dashboard builds this absolute snippet for you from the origin it was loaded
from, so copying it from the dashboard is always correct, including behind a
reverse proxy or TLS. The tracker derives its ingestion endpoint
(`/~analytics@1.0/session`) from this same origin automatically.

For non-dashboard registration, send a HyperBEAM signed request to
`/~analytics@1.0/register` with `name`, optional `origin` or `origins`, and
optional comma-separated `users` wallet addresses. Invited users can list and
view reports for the shared tracker, while only the owner can update the site
record. The JSON response includes `key`, a root-relative `script-path`, a
best-effort absolute `script-src` (derived from the request host/`x-forwarded-*`
headers), and a ready-to-paste `snippet`.

## API

- `index`: embedded dashboard
- `nonce`: dashboard auth nonce
- `register`: create/update a wallet-owned tracking registration
- `script`: public browser tracker script
- `session`: anonymous tracking ingestion
- `sites`: authenticated site list
- `report`: authenticated daily report

See [SPEC.md](./SPEC.md) for the full API and privacy model.

## Build

```sh
rebar3 compile
```

The dashboard source lives in `frontend/` and builds its React bundle into
`src/priv/dashboard.js`:

```sh
cd frontend
npm install
npm run build
```

## Package

```sh
rebar3 device package
rebar3 device verify
```

## Test

```sh
rebar3 device test
rebar3 eunit-all
```

## Local Node

```sh
rebar3 device local
```

Then open:

```text
http://localhost:8734/~analytics@1.0/index
```

## Publish

```sh
rebar3 device publish --key wallet.json
```

## Production

Download country db

```sh
mkdir -p /home/hb/geoip
curl -fL "https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz" -o /tmp/dbip.mmdb.gz
gunzip -c /tmp/dbip.mmdb.gz > /home/hb/geoip/dbip-country-lite.mmdb
```

```sh
ANALYTICS_GEOIP_DB=/home/hb/geoip/dbip-country-lite.mmdb HB_PORT=8735 HB_NODE_HOST=https://stats.forward.computer rebar3 device local
```

## Geolocation

Country demographics come from a CDN/edge geo header (`cf-ipcountry`,
`x-country-code`, `cloudfront-viewer-country`, …) when present. Behind a plain
reverse proxy that injects no such header, set `ANALYTICS_GEOIP_DB` to a
MaxMind/DB-IP **Country** `.mmdb` (absolute path or http(s) URL) and the device
resolves the visitor IP to a country server-side:

```sh
ANALYTICS_GEOIP_DB=/home/hb/geoip/dbip-country-lite.mmdb \
  HB_PORT=8735 HB_NODE_HOST=https://stats.forward.computer rebar3 device local
```

DB-IP's free "IP to Country Lite" and MaxMind's GeoLite2-Country both work;
without a header or a configured database, countries read as `Unknown`. The
lookup uses the client IP the reverse proxy forwards (`X-Real-IP` /
`X-Forwarded-For`), so that header must reach the node for geolocation — and
unique-visitor counts — to be accurate.

## License

This package is licensed under the [MIT License](./LICENSE).
