# Odysee on HyperBEAM

This repository is an Odysee-specific application built on upstream
HyperBEAM. It is deliberately not a fork of the HyperBEAM runtime.

The architecture is store-first:

```text
Static manifest frontend
    -> generic HyperBEAM HTTP routes
    -> generic committed messages and exact query
    -> local cache, Odysee source stores, or remote nodes
```

Legacy Odysee and LBRY services locate or transport source bytes for historical
content. They are not browser backends. The source stores validate those bytes
and produce content-addressed `lbry@1.0` evidence before serving or caching
them.

## Source of truth

The current implementation follows these decisions:

- [`decisions/hb-dependency.md`](decisions/hb-dependency.md): depend on a pinned
  upstream HyperBEAM revision instead of vendoring the runtime.
- [`decisions/store-first-no-app-devices.md`](decisions/store-first-no-app-devices.md):
  reads are store reads; native writes are generic committed messages.
- [`decisions/single-commitment-device.md`](decisions/single-commitment-device.md):
  one `lbry@1.0` verification device covers all LBRY evidence kinds.
- [`docs/architecture.md`](docs/architecture.md): full trust, node-role, read,
  and write architecture.
- [`ARCHITECTURE_READ_PATH.md`](ARCHITECTURE_READ_PATH.md): traced HTTP read
  path with implementation references.
- [`RUN_DEMO.md`](RUN_DEMO.md): local operation and end-to-end examples.

When an older branch or document conflicts with these decisions and the current
code, this store-first architecture wins.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/` | The standalone Odysee OTP application: LBRY verification, source stores, node helpers, generic search, reply-ID hook, and manifest publishing. |
| `odysee-frontend/` | The static React application and its HyperBEAM integration layer. |
| `docs/` | Architecture, data sourcing, evidence model, search, and node-operation documentation. |
| `decisions/` | Durable architectural decisions and their tradeoffs. |
| `patches/` | Narrow upstream HyperBEAM patches that cannot be expressed in this application. |
| `scripts/` | Operational scripts used by this architecture. |
| `rebar.config` | Pins the upstream HyperBEAM dependency and builds this application on top of it. |
| `config.json` | Demo node configuration for cookie-authenticated committed writes and store-first reads. |

There is intentionally no tracked `hyperbeam/` source tree. HyperBEAM is the
dependency under `_build/*/lib/hb`; product code stays in this repository's
`src/` directory.

## Runtime boundaries

### Devices

The application minimizes custom device surface:

| Device | Role |
| --- | --- |
| `lbry@1.0` | Verifies transactions, claim outputs, channels, streams, descriptors, blobs, and attestations from their native evidence. |
| `search@1.0` | Generic local full-text indexing and lookup. It is not an Odysee SDK proxy. |
| `reply-id@1.0` | Adds the committed message ID to cookie-auth write replies. |
| `odysee-auth@1.0` | Compatibility authentication helper where an existing session must be translated. It is not the native account model. |

There are no `odysee-claim@1.0`, `odysee-stream@1.0`,
`odysee-upload@1.0`, or `odysee-comment@1.0` application devices in the active
architecture. Strings such as `odysee-upload@1.0` and
`odysee-comment@1.0` are message schemas used for generic writes and queries,
not executable device endpoints.

### Stores

| Store | Role |
| --- | --- |
| `hb_store_odysee` | Classifies Odysee/LBRY keys, performs mutable locator lookups, constructs evidence, and warms local addresses. |
| `hb_store_lbry_transaction` | Fetches and verifies raw transactions. |
| `hb_store_lbry_claim_output` | Materializes immutable outpoint evidence. |
| `hb_store_lbry_stream_descriptor` | Fetches and verifies stream descriptors by SHA-384. |
| `hb_store_lbry_blob` | Fetches and verifies encrypted blobs by SHA-384. |

Local stores come first. Source stores fill misses and return committed evidence;
they are not alternate UI APIs.

## Identity

| Object | Identity |
| --- | --- |
| Native message | Its committed HyperBEAM message ID. |
| Legacy claim output | Immutable `<txid>:<nout>` outpoint. |
| Legacy transaction | Display-order 64-character transaction ID. |
| Legacy blob or descriptor | 96-character SHA-384 hash. |
| Legacy claim ID | Mutable locator for the current claim state. |
| Name or URI | Mutable lookup input, never immutable identity. |
| Native comment revision | Its own immutable message ID, linked to a logical root comment. |
| Native reaction revision | Its own immutable message ID, linked through stable logical reaction and version references. |
| Native playlist snapshot | Any verified commitment ID for its immutable message. Republished payloads receive new exact-read IDs. |

Bare immutable IDs read through the normal message/cache route. Mutable names
and claim IDs resolve through namespaced store paths before yielding immutable
evidence.

## Historical reads and playback

Historical claims and media use store paths such as:

```text
/~cache@1.0/read?read=odysee/claim/<uri>
/~cache@1.0/read?read=odysee/claim-id/<claim-id>
/~cache@1.0/read?read=odysee/stream-id/<txid>:<nout>
/~cache@1.0/read?read=odysee/media/stream-id/<txid>:<nout>
```

The store layer verifies transaction, descriptor, and blob evidence before
returning bytes. Hash mismatches fail closed. Mutable reads use `cache-control:
no-store, no-cache`; immutable ID reads may be cached indefinitely.

## Native account and writes

The node's `auth-hook@1.0` uses `cookie@1.0`. The first committed write mints a
`secret-*` cookie; later writes reuse the same signer. Hosted wallets use the
private non-volatile store, so the same valid cookie recovers the same
committer after a node restart. There is no email, password, browser wallet,
or Web2 account.

All native writes use the generic committed-ID route:

```text
POST /id?!=true&committers=all
```

The cookie is a request credential and must not be copied into the committed
message. The reply exposes the stored ID in `message-id`.

### Uploads

The browser posts raw file bytes directly to `/id?!`. It then writes a generic
`odysee-upload@1.0` index record that links the name and metadata to the
immutable data ID. Bare `lbry://<name>` resolution queries that record and
hydrates the immutable object. The uploads page queries the same records.

There is no legacy transcoder or TUS preparation path in HyperBEAM mode.
Transient `File` and pipeline objects are excluded from persisted Redux state.

### Comments

Comments are ordinary cookie-signed messages, not Commentron records and not
calls to a custom comment device. `query@1.0/only` discovers them from the
match index, then the frontend hydrates and verifies exact immutable IDs.

- Roots and replies are committed messages.
- Edits and author deletes are append-only revisions.
- A revision must be contiguous and owned by the same verified committer.
- Claimed profile fields never establish authority; the profile message must
  verify under the same committer.
- Additional emoji reaction types, moderation, and settings remain unsupported
  until they have native message contracts.

The normal UI does not call Commentron, the legacy LBRY API, or an Odysee SDK
proxy for comments.

### Reactions

Video and comment likes/dislikes are cookie-signed `odysee-reaction@1.0`
messages written through the same generic `/id?!` route. One target-wide
`query@1.0/only` request discovers immutable paths, then the frontend hydrates
and verifies every commitment and committer before counting it.

- Like, dislike, switch, and remove operations are append-only.
- Revisions link through signed `reaction-ref`, `version-ref`,
  `revision-of`, and `previous-version` fields.
- Only contiguous revisions from the root reaction's verified committer are
  accepted.
- Multiple roots from one committer still project to at most one reaction per
  target, preventing duplicate-message count inflation.
- Profile IDs and names are display metadata and never grant reaction
  authority.

There is no reaction application device and the browser does not call the
legacy reaction API.

### Playlists

Public playlists pair cookie-signed immutable `odysee-playlist@1.0` snapshots
with the pinned generic `reference@1.0` device. The reference init commitment
is the stable public route `/$/playlist/<reference-id>`. The frontend uses
generic `/id?!` writes, `query@1.0/only` discovery, and exact commitment
hydration; it does not call the LBRY `collection_*` API.

- Every message contains a complete ordered snapshot of immutable native IDs
  and/or legacy `<txid>:<nout>` outpoints.
- A republish after editing or reordering writes a new full snapshot and a
  strictly newer same-owner reference set while keeping the share URL stable.
  Earlier snapshots remain immutable and exactly addressable.
- Readers hydrate and verify every discovered init/set commitment and the
  selected snapshot. The init committer is the authority; foreign writers,
  stale or tied updates, and foreign-owned snapshots are rejected.
- Mutable 40-character claim IDs, names, and URIs are rejected as stored item
  identity; the integration layer resolves local draft URIs before publish.
- Duplicate physical reads are deduplicated by their returned locator. The playlist
  and its claimed profile must verify under the same committer.
- Queue, Watch Later, Favorites, and unpublished drafts stay local. Publishing
  a draft creates a new public immutable snapshot.

Playlist UI retains list, local edit/reorder, explicit snapshot publish, play,
shuffle, and share. Published delete remains hidden until it has an honest
append-only contract. The UI has no
blockchain channel picker, URL-name reservation, bid/stake, pending
confirmation, support/tip, report, or abandon-claim flow.

### Subscriptions

Free channel follows are cookie-signed `odysee-subscription@1.0` messages, not
paid memberships. A deterministic relationship reference binds the verified
subscriber committer to either a native profile ID or a full legacy channel
claim ID.

- Follow, notification-preference update, unfollow, and re-follow are
  append-only contiguous revisions.
- New follows default notifications off across every UI entry point; an
  explicit bell opt-in is preserved.
- Exact query discovers candidate IDs; the frontend hydrates and verifies each
  commitment, committer, and subscriber profile before projection.
- Redux and local persistence provide optimistic UI/cache state only. Account
  load replaces them with the authoritative node projection.
- The browser does not call the legacy subscription endpoint or wallet sync.
- A future one-time legacy import may seed relationships that do not already
  exist. Imported roots carry explicit provenance; all later changes stay on
  HyperBEAM.

Subscriber counts remain a separate derived aggregation and are not part of
this slice.

## Static manifest frontend

Production is a static SPA published as an Arweave path manifest and served by
the node's generic `manifest@1.0` hook. Manifest builds use hash routing,
relative assets, and node-safe content types. No production SSR or proxy tier
is part of the product data path.

```sh
cd odysee-frontend
pnpm run build:manifest
pnpm run publish:manifest
```

`ODYSEE_HYPERBEAM_NODE_API` is baked into the manifest build and should use the
same origin as the served frontend for cookie writes.

## Local validation

Backend:

```sh
rebar3 compile
HB_PORT=0 rebar3 eunit
rebar3 device test --with-core
```

Frontend:

```sh
cd odysee-frontend
pnpm run typecheck:tsc
pnpm run check
pnpm run test:native-comment-revisions
pnpm run test:native-message-verification
pnpm run test:native-comment-controls
pnpm run test:native-reactions
pnpm run test:native-playlists
pnpm run test:native-subscriptions
pnpm run test:static-manifest
pnpm run build:manifest
```

The cookie-owned browser lifecycle can be exercised against a running node:

```sh
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-reactions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-playlists
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-subscriptions
```

See [`RUN_DEMO.md`](RUN_DEMO.md) for the complete node and manifest launch
sequence.

## Current limitations

- Native view/subscriber counts and advanced moderation are not implemented.
- Upload edit/delete semantics still need a complete append-only design.
- Mutable-name currentness still depends on an external locator; the evidence
  proves content integrity, not canonical-chain freshness.
- Range propagation through the generic cache path is incomplete, so seeking
  may be limited even when whole-object playback works.
- The cookie account is local to a node/browser and is not yet a portable or
  recoverable production identity.
- TEE deployment and attestation require infrastructure beyond ordinary local
  development.

Do not hide these gaps by restoring direct browser calls to legacy services or
by rebuilding a fleet of product-specific devices.
