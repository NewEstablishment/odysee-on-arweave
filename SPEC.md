# `analytics@1.0`

`analytics@1.0` is a HyperBEAM device for decentralized page visit, duration,
basic demographic analytics, and generic qualified engagement. It provides a
public browser tracker script, public aggregate counters, a wallet-owned
registration and reporting API, and supports an independently hosted dashboard
UI. The device itself does not package or serve that frontend.

## Privacy Model

The tracker always creates one random in-memory visit ID per page load so
duration pings from the same open page can be joined. Sites use one of two
visitor identity modes:

- `daily` (default) writes no browser-persistent identifier. Unique visitors
  are unlinkable daily estimates derived from IP and User-Agent.
- `persistent` is an explicit site option for active-user, new/returning-user,
  acquisition, stickiness, and retention reporting. The tracker creates a
  random first-party ID in localStorage. The device immediately hashes it with
  a private per-site random salt and never stores or reports the raw value.

The device stores:

- tracking key
- full page pathname, without query string or hash (e.g. `/blog/my-post`) —
  every distinct path is tracked and reported separately, so filtering the
  dashboard by `/blog` sums everything under it while filtering by
  `/blog/my-post` scopes to that one page. This grows with every distinct
  URL a site publishes (e.g. one entry per blog post); there is no
  cardinality cap, so a site with a very large or unbounded set of
  id-based/dynamic routes will see a correspondingly large `pages` list
- event timestamps
- active duration in milliseconds
- daily aggregate counters
- client IP from common proxy headers, falling back to the connection peer
  (the `x-real-ip` header or raw socket address) when the device is reached
  directly with no proxy/CDN in front
- location fields from common CDN/edge geo headers when available; without an
  edge/CDN that injects geo headers (e.g. local direct access) country/region/
  city are left blank and surface as `Unknown`
- referrer **source host only** (e.g. `google.com`), never the full referring
  URL; referrers pointing at the site's own host (registered origins or the
  reported page origin) are internal navigations and recorded as `Direct`
- UTM tags (`utm_source`/`utm_medium`/`utm_campaign`) when present on the URL
- coarse device class, browser family and OS family **parsed from the
  User-Agent header server-side** — the raw User-Agent string is never stored
- primary language subtag (e.g. `en`)
- custom event names and counts
- per-day session records and a per-day **unique-visitor hash**
- for persistent sites, a private stable salted visitor hash, first/last-seen
  dates, first-touch acquisition, and per-day coarse audience dimensions

The unique-visitor hash is a SHA-256 of a per-site, per-day **random salt**, the
client IP and the User-Agent. The salt rotates every day and is never exposed,
so the hash cannot be correlated across days or reversed to the raw IP/UA. This
gives a cookieless unique-visitor estimate without a persistent identifier.

Persistent sites use a different private per-site salt to make the browser ID
linkable across days inside that one site. Stable hashes are retained in
private daily records to compute range-unique users and cohorts, but are removed
from every report response. They cannot be correlated across tracking keys.

The device does not store raw user agents, full referrer URLs, browser
fingerprints, cookies, or raw browser storage identifiers. In `daily` mode,
"unique visitors" are per-day estimates. In `persistent` mode, active users are
deduplicated across the requested report range. Operators must disclose and
lawfully configure persistent tracking for their deployment.

## Public API

Sites may be provisioned without registration through the `analytics-sites`
node option. Each entry accepts `key`, `name`, optional `owner`, `origins`,
`users`, `enabled`, `visitor-id-mode`, `engagement-threshold-ms`, and
`engagement-dedupe-window-ms`. An omitted owner defaults to the node wallet.

### `nonce`

Creates a short-lived nonce for wallet-signature dashboard authentication.

```text
GET /~analytics@1.0/nonce?owner=<wallet-address>
```

The response contains `nonce` and `message`. The dashboard signs `message` with
the connected Arweave wallet and sends the signature to owner-only endpoints.

### `register`

Registers a tracked site and returns its public tracking key plus an embeddable
script tag.

```text
GET /~analytics@1.0/register?name=My%20App&origin=https%3A%2F%2Fexample.com
```

The request must be authenticated by either:

- a HyperBEAM signed request whose signer is the site owner, or
- `owner`, `public-key`, `nonce`, and `signature` fields from the dashboard
  nonce flow.

Registration fields:

- `name`: display name
- `origin`: optional allowed browser origin
- `origins`: optional comma-separated allowed origins
- `users`: optional comma-separated wallet addresses that can list and view the
  tracker

If no origin is configured, any origin may submit tracking pings with the public
tracking key. Only the owner wallet can update the site record; invited users
receive read-only list/report access.

The JSON response contains:

- `key`: the public tracking key
- `script-path`: root-relative path to the tracker (`/~analytics@1.0/script?key=...`)
- `script-src`: best-effort absolute URL to the tracker, derived from the
  request host and `x-forwarded-proto`/`x-forwarded-host` headers, falling back
  to the request host plus the node's configured port. Falls back to
  `script-path` when no host can be determined.
- `snippet`: a ready-to-paste `<script async src="...">` tag using `script-src`
- `site`: the public site record

The dashboard ignores `snippet`/`script-src` and rebuilds the tag from the
browser's own origin (`window.location.origin`), which is authoritative behind
proxies and TLS; the absolute fields are provided for non-dashboard (API)
consumers.

### `script`

Returns the browser tracker with a tracking key embedded.

```html
<script async src="https://node.example/~analytics@1.0/script?key=<tracking-key>"></script>
```

The script sends the current page path, an in-memory page-view visit ID, event
type, and cumulative active duration. Hash-router paths such as `/#/blocks` are
reported as `/blocks`, and client-side route changes start a new page-view
visit.

### `session`

Accepts anonymous tracking pings.

```text
GET /~analytics@1.0/session?key=<tracking-key>&visit=<page-load-id>&event=start&page=/docs&duration=0
```

Optional acquisition/audience fields are read when present: `referrer` (reduced
to its source host), `utm_source`/`utm_medium`/`utm_campaign`, and `language`.
Device class, browser and OS are derived from the request's `user-agent` header
and stored only as coarse categories. On a new page-view the device also updates
a daily unique-visitor estimate and the visitor's session (30-minute inactivity
window), tracking bounce rate, pages-per-session, and landing/exit pages.

The endpoint is intentionally unsigned because it is called by visitors'
browsers. The tracking key is public; use `origin` restrictions during
registration to limit accepted origins when appropriate.

### `event`

Records a custom event for the site.

```text
POST /~analytics@1.0/event
Content-Type: application/json

{
  "key": "public-site-key",
  "name": "Play",
  "type": "action",
  "page": "/$/id/example",
  "subject-id": "optional-subject"
}
```

Like `session`, it is unsigned and subject to the same `origin` restrictions. The
browser tracker exposes `window.analytics("Signup")` as a convenience wrapper.
Every record is an event and appears in the report's `events` list with a count and conversion rate
(events ÷ sessions). The optional `page` attributes the event to that page's
own `events` list in `report`'s `pages` (see below) in addition to the
site-wide list; events sent without it (e.g. by a tracker script cached from
before this field existed) still count site-wide but aren't attributed to any
page. When `subject-id` is present, the event is also counted by name in that
subject's public aggregate. The device assigns no product meaning to the
subject or event name. `type` defaults to `event`. Records explicitly sent with
`type: "action"` also appear in the report's `actions` projection, including
the action name and page. Passive events such as impressions remain ordinary
events; the device does not classify actions by event name.

### `engagement`

Accepts an unsigned, origin-checked engagement lifecycle for an arbitrary
subject:

```http
POST /~analytics@1.0/engagement
Content-Type: application/json

{
  "key": "public-site-key",
  "subject-id": "arbitrary-stable-id",
  "interaction-id": "random-per-interaction-id",
  "event": "start|heartbeat|pause|complete|end",
  "sequence": 0,
  "active-ms": 0,
  "position-ms": 0
}
```

Sequence, active time, and position must be monotonic. A valid `start`
increments `raw`; reaching the active-time threshold produces at most one view
per privacy-preserving viewer/subject dedupe window. A completed interaction
provides evidence that a later qualified interaction is a replay and may count
again inside that window. A Play action by itself is not a view. Exact event replays are idempotent.
Invalid transitions and impossible time deltas are rejected and increment the
subject's `suspicious` counter. Interaction state retains cumulative
`active-ms` and `position-ms` plus `started-at`, `qualified-at`,
`view-counted-at`, `completed-at`, and `ended-at` timestamps when those
transitions occur. This preserves the source data needed for later aggregate
watch-time and completion reporting without treating control actions as watch
duration.

### `count` and `counts`

Return public aggregate counters for arbitrary subjects, including the
`events` map of custom-event counts associated with each subject. `counts` accepts an
ordered `subject-ids` list and returns up to 100 results in the same order.

```http
POST /~analytics@1.0/counts
Content-Type: application/json

{
  "key": "public-site-key",
  "subject-ids": ["subject-1", "subject-2"]
}
```

Each result contains `subject-id`, `raw`, `qualified`, `suspicious`, cumulative
`active-ms`, `completions`, `baseline`, and `total`, where
`total = baseline + qualified`.

### `subjects`

Returns newest-first paginated subject aggregates for one site. This operation
requires the same wallet authentication as `report`; the authenticated wallet
must own the site or be listed in its `users`.

```text
GET /~analytics@1.0/subjects?key=<tracking-key>&page=1&page-size=100
```

`page-size` is capped at 100. The response includes `subjects`, `page`,
`page-size`, and `total`. Each subject preserves the public count fields from
`count`, including the custom-event map and immutable baseline audit metadata.
This endpoint provides dashboard enumeration without weakening the public
known-subject `count` and `counts` contract.

### `baseline`

Imports a one-time aggregate baseline for a subject. The request must use the
same wallet authentication as owner-only registration operations, and only the
site owner may import it.

```http
POST /~analytics@1.0/baseline
Content-Type: application/json

{
  "key": "public-site-key",
  "subject-id": "subject-1",
  "value": 123,
  "version": "migration-version",
  "cutover-at": 1787234400,
  "source": "source-label"
}
```

The accepted baseline and its audit metadata are immutable. Replaying the same
record is idempotent; a conflicting value or version is rejected.

### `sites`

Returns the authenticated wallet's owned and invited sites.

```text
GET /~analytics@1.0/sites
```

Requires wallet-owner authentication.

### `report`

Returns daily aggregate analytics for one site.

```text
GET /~analytics@1.0/report?key=<tracking-key>&days=14&page=/blog
```

Requires wallet authentication. The authenticated wallet must own the requested
tracking key or be listed in the site's `users`.

The response includes up to 365 requested days and:

- `days`: daily aggregates, including the `by-*` buckets (`by-path`, `by-ip`,
  `by-location`, `by-referrer`, `by-utm-*`, `by-device`, `by-browser`, `by-os`,
  `by-language`, first-touch/session-touch acquisition buckets,
  `by-entry-page`, `by-exit-page`, `by-event`, and `by-action`) and per-day
  `unique-visitors`, `active-users`, `new-users`, `sessions`,
  `engaged-sessions`, `bounces`, `events`, and `actions` counters. Private
  stable visitor hashes and visitor-dimension maps are never returned. Each
  `by-path` entry additionally carries its own `sessions`, `bounces`, and
  nested `by-*` dimension/`by-event` buckets, scoped to that one page
- `pages`: per-page mini-reports over the requested range — `page`, `visits`,
  `duration-ms`, `max-duration-ms`, `sessions`, `bounces`, and page-scoped
  `demographics`/`acquisition`/`technology`/`events` in the same shape as the
  site-wide sections below. This is what lets the dashboard scope every stat
  to a selected route entirely client-side, by summing the entries whose
  `page` matches the route (exact match or a descendant — see the Privacy
  Model section above for what granularity is actually tracked)
- `demographics.ips` / `demographics.locations`: IP and location aggregates
  (site-wide; see `pages[].demographics` for the page-scoped equivalent)
- `acquisition`: visit-level `referrers`, `utm-sources`, `utm-mediums`, and
  `utm-campaigns`, plus generic `first-touch` user attribution and
  `session-touch` traffic attribution. Channel grouping is deliberately left
  to report consumers
- `technology`: `devices`, `browsers`, `operating-systems`, `languages`
  (site-wide; see `pages[].technology`)
- `navigation`: `landing-pages` and `exit-pages` (by session count)
- `events`: all custom events with `count`, `value`, and `conversion-rate`
  (site-wide; see `pages[].events`)
- `actions`: the separate projection of events explicitly sent as actions
- `audience`: active/new/returning users, active 1/7/28 day users,
  DAU/WAU/MAU ratios, and range-unique country/region/city/device/browser/OS/
  language breakdowns when persistent identity is enabled
- `retention`: day 1/7/14/30 cohorts. A checkpoint is marked ineligible when
  its target date is outside the requested report range
- `summary`: `visits`, `unique-visitors`, active/new/returning users,
  `sessions`, `engaged-sessions`, `engagement-rate`, `bounces`, `bounce-rate`,
  `pages-per-session`, `events`, `avg-duration-ms`, `avg-session-duration-ms`,
  maxima, `active` visitors, and `active-pages` (realtime top pages)

The optional `page` param scopes only the realtime `active`/`active-pages`
summary fields to visits whose current page matches it (exact match or a
descendant) — the rest of the response stays full/unfiltered, since
everything else can already be scoped client-side from `pages`/`days` above.
This keeps a page-filter change from requiring a full report refetch; only
the realtime poll needs to pass it.

`active` is the number of **open tabs** on the site: page-views that have
pinged within the active window and have not sent an `end`. The tracker
heartbeats every ~15s while a tab is open — including when it is backgrounded
(browsers throttle this to ~once/min) — so an open-but-unfocused tab keeps
counting. Closing the tab (or SPA-navigating away) sends `end`, dropping the
visit from the count immediately. The active window
(`analytics-active-window-ms`, default `120000` = 2 min) only bounds how long an
*ungraceful* exit (crash, killed tab, dropped network) lingers before ageing
out. All pings, `end` included, are sent with `fetch(..., {keepalive:true})` so
they survive page unload.

## Storage

Records are written to the configured HyperBEAM store under `analytics` by
default. The root can be changed with the `analytics-root` node option. The
layout is:

- `analytics/sites/<key>` — site record (read by key)
- `analytics/owners/<wallet>/<key>` — per-wallet index of owned/shared site
  keys (listed by `sites`)
- `analytics/daily/<key>/<date>` — daily aggregate counters (read by key/date)
- `analytics/visits/<key>/<date>/<visit>` — per-visit records (listed by
  `report`'s active-visitor count)
- `analytics/salts/<key>/<date>` — per-day random salt for the visitor hash
- `analytics/visitors/<key>/<date>/<hash>` — write-once unique-visitor markers
- `analytics/persistent-visitor-salts/<key>` — private per-site salt used only
  when persistent visitor mode is enabled
- `analytics/persistent-visitors/<key>/<hash>` — private first/last-seen and
  first-touch record; hashes are never returned by `report`
- `analytics/sessions/<key>/<date>/<hash>` — per-visitor session state,
  including the set of distinct pages seen so far this session (used to
  attribute per-page `sessions`/`bounces` in `daily`'s `by-path` as pings
  arrive, not by re-reading this record later — it's overwritten once a new
  session opens for the same visitor later the same day)
- `analytics/nonces/<owner>/<nonce>` — short-lived dashboard auth nonces
- `analytics/subjects/<key>/<subject>` — public engagement aggregate and
  imported baseline for one subject
- `analytics/engagements/<key>/<subject>/<interaction>` — validated interaction
  state used for idempotency and qualification, including cumulative active
  watch time, playback position, and lifecycle timestamps

Directory-style listing requires an explicit group marker at the listed path on
stores that do not create one implicitly on write (notably `hb_store_lmdb`, the
default primary store for a running node; `hb_store_fs` and `hb_store_volatile`
create it on write). The device therefore ensures the group marker for
`owners/<owner>` and `visits/<key>/<date>` immediately before listing them. This
is idempotent and also self-heals index entries whose underlying leaf writes
succeeded before a marker existed.

## Build

```sh
rebar3 compile
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

The dashboard is a separately hosted frontend and is not exported by this
device.

## License

This package is licensed under the [MIT License](./LICENSE).
