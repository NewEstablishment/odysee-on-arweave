# Odysee analytics integration

Odysee uses the reusable `analytics@1.0` device for page analytics and media
engagement. There is no Odysee-specific analytics device. Product identity,
playback lifecycle handling, and Redux adaptation remain in the frontend
integration layer.

## Deployment contract

The node provisions the public tracking key in `config.json`:

```json
{
  "analytics-sites": [
    {
      "key": "odysee",
      "name": "Odysee",
      "owner": "ARWEAVE_WALLET_ADDRESS",
      "origins": ["https://example.invalid"],
      "visitor-id-mode": "persistent",
      "engagement-threshold-ms": 30000,
      "engagement-dedupe-window-ms": 86400000
    }
  ]
}
```

`ODYSEE_ANALYTICS_TRACKING_KEY` in the frontend build must match the configured
site key. An empty `origins` list accepts browser events from any origin and is
appropriate only for local development or a deliberately public collector.

The analytics device does not package or serve a dashboard. The configured
`odysee` site is provisioned automatically, so operators do not need an Add
Site flow for it. Reports remain wallet-authenticated through the generic
`report` API and can be viewed with an independently hosted analytics
dashboard. The Odysee application does not expose an analytics report UI.

Set an explicit `owner` before importing a historical baseline. If omitted, the
device uses the node wallet, which is unsuitable as a stable migration identity
unless that wallet is deliberately persisted and available to the operator.

## Browser behavior

At startup, `ui/analytics/hyperbeam.ts` loads the generic tracker script from
the configured HyperBEAM node. It records page loads and SPA route changes
through `session`.

For media playback, `ui/analytics/watchman.ts` replaces the legacy Watchman
transport with this generic engagement lifecycle:

- `start` after playback starts;
- `heartbeat` with monotonically increasing active and playback time;
- `pause` when playback pauses;
- `complete` when playback reaches its end;
- `end` when playback ends or the page unloads.

Each playback has a random in-memory `interaction-id`. The `subject-id` is the
stable logical media identity selected by the Odysee adapter. The device does
not interpret either value. Livestreams do not count. A preview that remains
active for three seconds records a generic `impression` custom event for the
same subject, but does not start an engagement or increment view totals.

Playback controls are also sent to the generic event endpoint with
`type: "action"`. Play, Pause, and Complete therefore remain part of the full
event stream and are additionally projected into the dashboard's Actions
section with their page. Passive preview impressions use `type: "event"` and
are never projected into Actions.

The device increments `raw` once for a valid start. Reaching the cumulative
active playback threshold produces at most one view for a privacy-preserving
viewer/subject pair during the configured dedupe window. Completing a watch
provides evidence that a later qualified playback is a genuine replay and may
count a second view inside the same window. A Play action alone never increments
the view total. Repeated events are idempotent. Regressions, impossible
elapsed-time jumps, and invalid lifecycle transitions are rejected and counted
as suspicious. Each interaction retains cumulative active watch time, playback
position, and lifecycle timestamps. Those records are sufficient to derive
total watch minutes and completion metrics later; no such UI is part of the
current view-counter work.

Claim tiles and media pages request public totals from `count` or batched
`counts`. The displayed value is:

```text
total = imported baseline + qualified native engagements
```

These aggregate endpoints are public and require no Odysee account, cookie, or
wallet. Detailed site reports and baseline writes remain owner-authenticated.

The browser never calls legacy Watchman or the legacy view-count API after the
cutover.

## Legacy baseline import

Generate a cutover export from the legacy media IDs in Meilisearch. The
exporter creates a transient anonymous legacy service token and refreshes the
authoritative view totals; no Odysee viewer account or login is required:

```sh
node scripts/export-legacy-analytics-baseline.mjs \
  --meili-url http://127.0.0.1:7700 \
  --index odysee_claims \
  --output /secure/path/legacy-view-counts.json
```

Stop legacy ingestion at the chosen cutover before exporting so counts cannot
be lost between export and native activation. An explicit
`ODYSEE_API_AUTH_TOKEN` or `--odysee-api-token` may be supplied by operators who
already have one. Pass `--use-index-counts` only when indexed `view_count`
values were refreshed at cutover and should be used without API requests. Both
paths stream bounded batches and atomically write the same baseline format.

The importer also accepts an independently produced JSON object:

```json
{
  "stable-subject-id-1": 123,
  "stable-subject-id-2": 456
}
```

or an array:

```json
[
  { "subject-id": "stable-subject-id-1", "value": 123 }
]
```

Then run:

```sh
node scripts/import-analytics-baseline.mjs \
  --node http://127.0.0.1:18801 \
  --key odysee \
  --wallet /secure/path/analytics-owner.json \
  --input /secure/path/legacy-view-counts.json \
  --version legacy-watchman-2026-08-20 \
  --cutover-at 1787234400 \
  --source legacy-watchman
```

The wallet must match the configured site's `owner`. The importer obtains a
single-use nonce and signs each baseline write. Use `--dry-run` to validate the
input and `--start-at N` to resume after an interrupted import. Accepted values
are immutable per subject; replaying the same value and metadata is idempotent,
while a conflicting replacement is rejected.

Never commit the wallet, baseline export, or generated node data.

## Legacy analytics dashboard data contract

The existing `OdyseeTeam/odysee-analytics` dashboard combines web-observation
analytics with authoritative product KPIs. Replacing GA4 and the legacy view
backend therefore uses two source classes rather than forcing product semantics
into the reusable device.

Generic `analytics@1.0` reports provide the source data for:

- raw page loads and deduplicated page visits;
- active/new/returning users and active 1/7/28-day stickiness;
- sessions, engaged sessions, duration, engagement rate, bounces, and landing/
  exit pages;
- all events plus a separate explicit Actions projection;
- first-touch user and session-touch referrer/UTM attribution. The dashboard
  adapter derives its display channel groups from these generic dimensions;
- country/region/city and coarse device/browser/OS/language active-user
  breakdowns;
- current active tabs/pages and retention cohorts;
- public subject totals (`baseline + qualified`) for media views;
- authenticated subject enumeration for the Events dashboard, including raw
  plays, qualified/native views, imported baselines, active time, completions,
  suspicious transitions, event totals, and baseline audit metadata.

The following remain authoritative product data and must be read from verified
native messages, generic indexes, or an explicit migration snapshot:

- uploads and manual-upload counts;
- profiles/accounts and any verified-account status;
- subscriptions/followers;
- synced/imported channel and media inventory;
- creator/category operational rankings;
- historical media views, imported once as the immutable baseline.

Product state may emit generic events for operational monitoring, but those
events do not replace authoritative message-derived totals. The future legacy
dashboard adapter should translate its existing GA4-shaped API responses from
the generic report fields above and query product KPIs independently. No
Odysee, LBRY, Watchman, GA4, claim, upload, or follower names belong in
`dev_analytics`.

## Packaging and operation

HyperBEAM executes the packaged device from the preloaded store. After changing
`src/dev_analytics.erl`, rebuild that store before starting the node:

```sh
rm -rf _build/device-local-store
HB_PORT=18734 rebar3 device preload \
  --device-src src,_build/default/lib/reference_1_0/src \
  --output-dir _build/device-local-store \
  --verbose
```

Starting a node against a stale preloaded store runs the old implementation
even if `rebar3 compile` and EUnit used the new source. The external reference
source is required because public playlists and encrypted preferences use
`reference@1.0` for stable append-only identity.

## Boundaries

- `analytics@1.0` remains generic and reusable.
- The device does not contain Odysee, LBRY, claim, Watchman, or media-specific
  semantics.
- Odysee maps product identities and playback state to generic fields in the
  frontend adapter.
- Page reports require wallet authentication; public media count endpoints
  expose aggregate counters only.
- Analytics records are observational signals, not authoritative content or
  identity state.
