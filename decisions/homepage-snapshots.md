# HyperBEAM-owned homepage snapshots

## Decision

Homepage and category claim selections are immutable, node-signed
`odysee-homepage@1.0` messages. The frontend bundle contains presentation
templates only.

At startup, the Odysee OTP application writes the immutable Lua materializer
and its language plan to the node cache. The Lua script executes its store and
search subrequests with `ao.resolve`, follows HyperBEAM message links, and
exact-hydrates candidate media and channels. It commits the completed snapshot
as a flat message containing canonical `homepage-json` with generic
`message@1.0` behavior, then submits a node-signed registration to
stock `local-name@1.0`. Registration persists the immutable snapshot through
`hb_cache` and atomically updates the node-local `odysee-homepage-<language>`
pointer. The node starts with one bounded
snapshot for the configured initial language. After that succeeds, stock
`cron@1.0` immediately builds the full all-language pool and repeats at the
configured interval.

The Lua refresh result contains only publication summaries and immutable IDs.
It must not return a snapshot payload, because the enclosing Lua result has its
own commitment and must never become a second object matching the snapshot
discovery schema.

Snapshot publication does not leave the node or use a loopback HTTP relay. AO
resolution legitimately adds hashpath commitments to computation messages,
while HTTP Signature transport cannot flatten the resulting mixed commitment
set safely. Local registration keeps the entire materialization, commitment,
and persistence sequence inside stock HyperBEAM devices.

The homepage payload is a JSON string rather than a nested signed-message tree.
Lua resolver metadata must not become keys inside category, media-ID, or channel
maps. Consumers verify the flat snapshot first and parse `homepage-json` only
after verification; they continue to accept the older nested `homepage` field.

Consumers discover snapshot locators with `query@1.0`, exact-read them, verify
the commitment and require the node's own committer. The newest valid snapshot
for the language wins. Failed refreshes do not replace or delete prior valid
messages.

## Consequences

- A deployment generates snapshots from its own store and search index.
- Homepage rows and category routes share the same ordered immutable pools.
- Every media category contains at most one claim from a signing channel. The
  materializer requests that limit from its source and enforces it again while
  building the immutable pool; a valid pinned claim takes precedence.
- Signed homepage media are eligible only when exact hydration exposes a
  usable thumbnail and the effective release time is not in the future. The
  separate Local content materializer also requires a usable thumbnail, but
  intentionally retains scheduled and upcoming streams.
- Homepage media discovery is stream-only. Repost wrappers are never published
  in signed category pools, featured media, or the separate Local content row.
- Optional local content is configuration, not a product rule in a generic
  device.
- The demo-only Local content row is materialized into the frontend manifest
  from the deployment node's search index and exact immutable store reads. It
  remains separate from signed language snapshots and cron refreshes, and
  overfetches candidates so rejected media do not create a short row.
- SSR, browser timers, filesystem JSON, and build-time materialization are not
  authority or refresh mechanisms for language snapshots.
- The Lua script and snapshot can be executed and verified on stock HyperBEAM
  primitives without trusting a custom homepage device.
