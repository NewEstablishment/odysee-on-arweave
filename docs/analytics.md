# Analytics

This repository contains the HyperBEAM package for `analytics@1.0`, a
web page analytics tool.

It lets a wallet register an HTML app, receive a public tracking key, embed a
small script tag, invite additional wallet addresses to view a tracker, and see
visits/durations/demographics in an externally hosted dashboard. The device
contains only the analytics API and browser tracker; it does not package or
serve the frontend. Nodes may also provision sites through configuration.
Tracking uses no browser storage by default. A site can explicitly enable a
random first-party persistent visitor ID for cross-day audience and retention
metrics.

## What It Measures

- daily anonymous page-load visits
- active duration per visit
- average duration
- sessions, engaged sessions, bounce and engagement rates
- active, new, and returning users with 1/7/28-day stickiness
- first-touch and session-touch referrer/UTM attribution
- retention cohorts at day 1/7/14/30
- active visits seen recently
- page pathname breakdowns
- generic events and an explicit action projection
- qualified subject engagement and imported aggregate baselines
- coarse device, browser, operating-system, and language breakdowns
- IP address breakdowns
- location breakdowns from CDN/proxy geo headers when available

The device never stores raw user agents, full referrer URLs, cookies,
fingerprints, or raw browser identifiers. It stores the visitor IP reported by
common proxy headers and best-effort location fields. In default `daily` mode,
the device uses rotating per-day salted IP/User-Agent hashes. In opt-in
`persistent` mode, the tracker keeps a random ID in localStorage and the device
stores only its per-site salted hash. Stable hashes remain private and are
removed from reports.

## Provision A Site

Product deployments can provision tracking keys without an interactive
registration flow:

```json
{
  "analytics-sites": [
    {
      "key": "public-site-key",
      "name": "Example",
      "owner": "ARWEAVE_WALLET_ADDRESS",
      "origins": ["https://example.com"],
      "visitor-id-mode": "persistent",
      "engagement-threshold-ms": 30000,
      "engagement-dedupe-window-ms": 86400000
    }
  ]
}
```

Public tracking, engagement, and aggregate-count endpoints remain available,
as do wallet-authenticated reports. For interactive registration, use the
externally hosted dashboard or run the upstream dashboard locally from the
`frontend/` directory of the `analytics-1.0` repository. Connect an Arweave
wallet, register a site, and copy the returned snippet into your site's HTML:

Configured `analytics-sites` are listed for their owner and invited users
without requiring a separate registration write. Set `owner` to the public
address of the wallet used by the dashboard; never copy the node's private
wallet into the dashboard.

```html
<script async src="https://your-node.example/~analytics@1.0/script?key=TRACKING_KEY"></script>
```

The `src` must be an **absolute** URL pointing at the HyperBEAM node that runs
this device (e.g. `http://localhost:8734/...` when developing locally, or your
node's public origin in production) — not a root-relative `/~analytics@1.0/...`
path, which a browser would resolve against the tracked site's own domain. The
external dashboard builds an absolute snippet targeting its configured
analytics node. The tracker derives its ingestion endpoint
(`/~analytics@1.0/session`) from this same origin automatically.

For non-dashboard registration, send a HyperBEAM signed request to
`/~analytics@1.0/register` with `name`, optional `origin` or `origins`, and
optional comma-separated `users` wallet addresses. Invited users can list and
view reports for the shared tracker, while only the owner can update the site
record. The JSON response includes `key`, a root-relative `script-path`, a
best-effort absolute `script-src` (derived from the request host/`x-forwarded-*`
headers), and a ready-to-paste `snippet`.

## API

- `nonce`: dashboard auth nonce
- `register`: create/update a wallet-owned tracking registration
- `script`: public browser tracker script
- `session`: anonymous tracking ingestion
- `event`: generic event ingestion, optionally action-typed and counted against a generic `subject-id`
- `engagement`: generic resumable engagement ingestion
- `count`: public engagement, cumulative active-time/completion, and
  custom-event aggregates for one subject
- `counts`: ordered public aggregates for up to 100 subjects
- `subjects`: owner/viewer-authenticated paginated subject aggregates used by
  the Events dashboard
- `baseline`: owner-authenticated immutable baseline import
- `sites`: authenticated site list
- `report`: authenticated daily report

See [SPEC.md](./SPEC.md) for the full API and privacy model.

## Build

```sh
rebar3 compile
```

The dashboard is maintained and deployed separately by the upstream
`analytics-1.0` project. It builds as a standalone static site:

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

The analytics API is then available at:

```text
http://localhost:8734/~analytics@1.0/<endpoint>
```

The device deliberately has no dashboard route. Run the upstream standalone
frontend separately when an operator UI is required.

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
