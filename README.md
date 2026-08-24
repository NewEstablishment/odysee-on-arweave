# Odysee on HyperBEAM

This repository is an Odysee-specific application built on upstream
HyperBEAM. It is deliberately not a fork of the HyperBEAM runtime.

The browser has one product-data path: HyperBEAM. Existing Odysee services,
Chainquery, Commentron, blob servers, and the LBRY SDK are compatibility sources
behind HyperBEAM devices and stores. They are not an alternate browser mode.

## Index

- [Project Status](#project-status)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Identity Model](#identity-model)
- [Device Model](#device-model)
  - [Generic HyperBEAM Devices](#generic-hyperbeam-devices)
  - [Odysee Devices](#odysee-devices)
  - [LBRY Codecs and Commitment Devices](#lbry-codecs-and-commitment-devices)
- [Stores](#stores)
- [LBRY Verification Libraries](#lbry-verification-libraries)
- [Frontend and SSR Integration](#frontend-and-ssr-integration)
- [Feature Flows](#feature-flows)
  - [Claim Resolution and Hydration](#claim-resolution-and-hydration)
  - [Playback and Media](#playback-and-media)
  - [Search](#search)
  - [Comments, Revisions, and Moderation](#comments-revisions-and-moderation)
  - [Reactions](#reactions)
  - [Playlists](#playlists)
  - [Follows and Subscriptions](#follows-and-subscriptions)
  - [Uploads and Thumbnails](#uploads-and-thumbnails)
  - [Authentication](#authentication)
  - [Static Manifest Publishing](#static-manifest-publishing)
- [Trust and Verification Boundaries](#trust-and-verification-boundaries)
- [Configuration](#configuration)
- [Local Development](#local-development)
- [Importing Chainquery into Meilisearch](#importing-chainquery-into-meilisearch)
- [Testing](#testing)
- [Diagnostics](#diagnostics)
- [Current Limitations](#current-limitations)
- [Working on the Repository](#working-on-the-repository)

## Project Status

The current integration has these non-negotiable contracts:

1. Browser and SSR product operations route through HyperBEAM.
2. Immutable reads are ID-first. A read for an immutable ID returns that object,
   not whichever mutable claim version is current.
3. Search and query return ordered IDs or paths. Object hydration is a separate
   store read.
4. Generic HyperBEAM devices remain product-agnostic. Odysee behavior belongs in
   Odysee devices, stores, or the frontend integration boundary.
5. Legacy services may source historical data, but browser code must not call them
   as an alternate product path.
6. Authentication tokens and cookies are request inputs. They must not be included
   in public signed or persisted messages.

The retired catch-all `odysee@1.0` SDK facade and browser-selectable legacy mode
must not be restored. Narrow devices own explicit contracts instead.

## Architecture

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

The system contains mutable compatibility identifiers and immutable content
identifiers. Confusing them causes stale metadata, unverifiable reads, duplicate
results, and broken playback.

| Object | Canonical identity | Notes |
| --- | --- | --- |
| Native HyperBEAM message | HyperBEAM message ID | Immutable and derived from the committed message. |
| Legacy transaction output | `<txid>:<nout>` | Immutable claim-output identity. Canonical store path is `odysee/claim-output/<txid>/<nout>`. |
| Legacy transaction | Display-order 64-character transaction ID | Verified by hashing raw transaction bytes. |
| Legacy blob | 96-character SHA-384 blob hash | The fetched bytes must hash to the requested value. |
| Stream descriptor | `sd_hash` | SHA-384 identity for the raw descriptor blob. |
| Legacy claim ID | 40-character claim ID | Stable across claim updates but points at mutable current state; treat it as a reference key. |
| LBRY/Odysee name | URI/name | Mutable lookup input, never an immutable store key. |
| Search document | `doc_id`/`search_id` | Immutable locator used by Meilisearch; the search document is not the source object. |
| Native comment revision | Physical message ID | Immutable version. The root comment ID remains the logical thread identity. |

Names and claim IDs eventually resolve through reference semantics to immutable
objects. Search and exact query return locators; callers hydrate those locators
through ordinary HyperBEAM reads.

## Device Model

HyperBEAM device routes use the form `/<device>/<operation>`, normally with a
tilde-prefixed device name such as `/~odysee-claim@1.0/resolve`. A direct `/<id>`
read addresses an immutable object through the configured store stack.

### Generic HyperBEAM Devices

These devices are reusable HyperBEAM infrastructure. Do not add Odysee-specific
special cases to them.

| Device | Operations used here | Role |
| --- | --- | --- |
| `query@1.0` | `only`, `all`, `base`, `graphql` | Exact message discovery across supported stores. Match keys are selected with `only`; results can be paths, messages, counts, first matches, or booleans. Native comments and controls use it to discover immutable message IDs. |
| `search@1.0` | `query`, `write` | Generic full-text indexing for arbitrary HyperBEAM messages through `hb_search`. Its schema and backend come from node/base configuration, and queries retrieve only ordered immutable `id` values. Odysee claim search uses this unchanged device directly. |
| `cache@1.0` | `read`, `write`, related cache operations | Signed cache access. Trusted writes require an authorized signer in the node's `cache_writers` list. Thumbnail storage uses this device. |
| `auth-hook@1.0` | request hook/generator flow | Extracts credentials, invokes a configured secret provider, signs the request, and removes private carriers before public persistence. |
| `message@1.0` and `/id` | inherited message operations | Normalize a message and derive/store its immutable ID. Native writes use this path instead of an Odysee-specific persistence endpoint. |
| HTTP signature codecs | commit/verify during transport | Carry RSA-PSS or HMAC commitments over AO-Core messages. The browser debug console reports the observed algorithm but is not itself the verifier. |

### Odysee Devices

These devices own product contracts and legacy normalization. Source files live
under `hyperbeam/src/preloaded/odysee/` unless noted otherwise.

| Device | Public operations | Responsibility |
| --- | --- | --- |
| `odysee-account@1.0` | `preference-get`, `preference-set`, `settings-get`, `settings-set`, `settings-clear`, `user-exists`, `user-new`, `user-signin`, `user-me`, `user-email-resend-token`, `user-email-confirm`, `account-status`, `sub-count` | Narrow account/auth/settings compatibility surface. It deliberately does not recreate the old catch-all SDK proxy. Subscription count is exposed through this device. |
| `odysee-channel@1.0` | `channel`, `from-claim` | Normalizes a channel from a URI or claim and exposes channel public-key material needed for signature verification. |
| `odysee-claim@1.0` | `resolve`, `search`, `transaction` | Resolves names/URLs, searches historical claim metadata, and sources raw transactions. Store-first reads and immutable outpoints remain separate from mutable claim resolution. |
| `odysee-claim-proof@1.0` | `decode`, `verify` | Parses a raw transaction output, verifies transaction ID/output position and claim script structure, and produces normalized claim-output proof material. |
| `odysee-comment@1.0` | `list`, `super-list`, `by-id`, `create`, `edit`, `pin`, `abandon`, `reaction-react`, setting/moderation methods, `normalize`, `verify-signature`, `verify-claim-signature` | Historical Commentron compatibility, normalized comment rows, and LBRY channel-signature checks. Native comments themselves are generic signed messages discovered with `query@1.0`. |
| `odysee-file@1.0` | `view-count`, `normalize` | Reads and normalizes file view counts through the Odysee API compatibility boundary. |
| `odysee-file-reaction@1.0` | `list`, `normalize` | Reads and normalizes file reactions. |
| `odysee-reaction@1.0` | `list`, `normalize` | Historical reaction compatibility only. Native browser reactions are generic committed messages and do not call this device. |
| `owned-reference@1.0` | `point`, `current`, `resolve` | Owner-gated mutable pointer above immutable objects. Ownership is tied to authenticated authority rather than arbitrary first-writer state. Source: `src/preloaded/odysee/dev_odysee_owned_reference.erl`. |
| `odysee-reference@1.0` | `point`, `current`, `resolve` | Operator-gated mutable reference used for compatibility and controlled pointer updates. |
| `odysee-policy@1.0` | `evaluate`, `enforce` | Evaluates signed policy rules against request/message fields and can reject disallowed playback or delivery. |
| `odysee-stream@1.0` | `stream`, `from-claim`, `playback`, `media`, `verified-stream` | Resolves stream metadata, immutable claim outputs, descriptors, ranged media, and playback URLs. It prefers verifiable LBRY evidence and exposes source/verification headers when a compatibility player proxy is used. |
| `odysee-stream-descriptor@1.0` | `decode`, `fetch`, `verify`, `reconstruct`, `media` | Product-facing descriptor orchestration: fetches and verifies descriptor data, reconstructs streams, and serves ranges through LBRY stores/codecs. |
| `odysee-upload@1.0` | `submit`, `upload`, `write`, `chunk`, `finalize`, `index`, `update`, `delete`, `record`, `media`, `list`, `reconcile`, `reindex` | Authenticated native uploads, chunk manifests, ownership records, metadata revisions, listing, deletion state, media access, and search-index reconciliation. |
| `odysee-auth@1.0` | `commit`, `verify`, `generate`, `legacy-api-headers` | Secret provider for `auth-hook@1.0`. Maps an Odysee session to account authority, derives request signing material, creates compatibility API headers, and strips raw credentials before persistence. Source: `src/preloaded/auth/dev_odysee_auth.erl`. |
| `odysee-publish-gate@1.0` | `request` | Request hook that rejects protected publish/upload paths without a cookie or authorization credential. Source: `src/preloaded/auth/dev_odysee_publish_gate.erl`. |

`dev_odysee_subscription.erl` is an internal subscription-count implementation.
It intentionally has no separate frontend product surface; `odysee-account@1.0`
delegates `sub-count` to it.

### LBRY Codecs and Commitment Devices

These devices represent and verify source-native evidence. Most codecs expose
`from`, `to`, `to-hint`, and `verify`; the exceptions are noted below. Source
files live under `hyperbeam/src/preloaded/codec/` unless stated otherwise.

| Device | Native evidence and verification |
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
`secret-*` cookie; later writes reuse the same signer. There is no email,
password, browser wallet, or Web2 account.

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
- Advanced reactions, moderation, and settings remain unsupported until they
  have native message contracts.

The normal UI does not call Commentron, the legacy LBRY API, or an Odysee SDK
proxy for comments.

## Static manifest frontend

Production is a static SPA published as an Arweave path manifest and served by
the node's generic `manifest@1.0` hook. Manifest builds use hash routing,
relative assets, and node-safe content types. No production SSR or proxy tier
is part of the product data path.

The generic index combines normalized Chainquery rows and native upload records.
Search responses contain ordered immutable locators; the
frontend hydrates each locator through stores and preserves result order. Search
documents may contain display metadata for ranking/debugging, but they are not
authoritative claim objects.

Search ranking first maximizes matched query words and then evaluates textual
relevance across `title`, `name`, `tags_text`, and `description`, in that order.
Within equally relevant matches, channel claims precede media, followed by
thumbnail quality, recency, bounded view count, and bounded channel subscriber
count. Each document carries a `search_group`: a channel claim and its media
share the logical channel ID, while unchanneled media use their immutable ID.
The index returns at most one result per group so one publisher cannot fill a
result page, while exact channel names and titles remain eligible.

Filters such as claim type, media type, NSFW state, visibility, upload date, and
sort mode must reach `search@1.0`. Reimplementing them as unrelated
post-filtering in React changes pagination and ranking.

### Comments, Revisions, and Moderation

Native comments are structured messages written through the same generic
`POST /id?!=true&committers=all` path as native uploads. The node's
`cookie@1.0` identity commits each write; comments do not call Commentron or
require an LBRY channel signature. Their stable selectors include
`type=comment`, `target`, `parent`, and `schema=odysee-comment@1.0`.

One target-wide `query@1.0/only` request discovers native comment IDs. Product
logic then hydrates messages and performs:

- logical-root deduplication;
- latest valid revision selection;
- root/reply hierarchy construction;
- total and reply counts;
- sorting and pagination;
- owner-control projection.

Each root has an application-level `comment-ref`, and every stored version has a
`version-ref`; query results are still hydrated and verified by their physical
immutable message IDs. Edits and deletes are append-only revisions linked with
`revision-of`, `previous-version`, and a monotonically increasing revision
number. The current view accepts only a contiguous chain whose exact commitment
verifies and whose transport committer matches the root committer. The local
HyperBEAM account must be signed in before a comment is written and supplies a
display name only after that profile record verifies under the same committer.

Channel-owner actions such as hide, pin, creator heart, and creator-channel block
are append-only `odysee-comment-control@1.0` messages. The latest valid authorized
control event determines the projection; the original comment is never mutated.
The current native lifecycle covers roots, replies, edits, and author deletes.
Pinning, creator reactions, channel blocking, delegates, and mutable comment
settings remain unsupported until they have cookie-committer-native contracts;
they do not fall back to Commentron.

### Reactions

Video and comment likes/dislikes are generic `odysee-reaction@1.0` messages
written through `POST /id?!=true&committers=all`. Exact `query@1.0/only`
selectors discover locators; the frontend then hydrates and verifies each exact
message and derives its owner from the selected commitment's committer.

Each committer has at most one projected reaction per target and subject.
Switches, removals, and toggles are append-only revisions linked by stable
reaction and version references. Projection accepts only contiguous same-owner
chains, stops at forks, and rejects conflicting copies of one semantic version.
Neither video nor comment reactions call the historical reaction API.

### Playlists

Public playlists are generic immutable `odysee-playlist@1.0` snapshot messages.
A snapshot contains ordered immutable native message IDs or legacy
`<txid>:<nout>` outpoints; local draft URIs are resolved before publishing and
mutable claim IDs are never stored as item identity. Query results are locators
that are hydrated and verified before a playlist is displayed.

Publishing produces a new message ID and share URL. Editing a published playlist
changes local state until the user explicitly publishes another independent
snapshot; it does not mutate, delete, or auto-update the old snapshot. Queue,
Watch Later, Favorites, and unpublished drafts stay local. Stable mutable
playlist references remain deferred until the canonical reference-device
contract is supplied.

### Follows and Subscriptions

Free channel follows are generic `odysee-subscription@1.0` messages written
through `POST /id?!=true&committers=all`. The relationship identity combines
the verified cookie committer with a stable native channel ID or full legacy
channel claim ID.

Follow, notification-preference update, unfollow, and re-follow operations are
append-only revisions linked by `revision-of`, `previous-version`, and a
monotonic revision number. Discovery uses exact `query@1.0/only` selectors;
each locator is hydrated by immutable ID, commitment-verified, and attributed
to its exact committer. Forks, gaps, foreign writers, conflicting semantic
duplicates, and unverifiable profile claims fail closed. The browser does not
call the legacy subscription API.

New follows default to notifications off unless the user explicitly enables
the bell. A one-time legacy import, aggregate subscriber counts, paid
memberships, and Following-feed content aggregation are separate contracts.

### Uploads and Thumbnails

Large files are split into chunks by the browser/SSR upload bridge. Each chunk is
stored by immutable ID, then `odysee-upload@1.0` finalizes a manifest and creates
an authenticated upload/index record. Update and delete operations append new
state and reconcile the Meilisearch document rather than mutating an immutable
media object.

Thumbnail bytes are written through `cache@1.0/write`. The SSR server holds
`HYPERBEAM_CACHE_WRITER_JWK`, signs the request, and never sends the private key to
the browser. The corresponding signer address must be configured in the node's
`cache_writers` list.

### Authentication

The browser's Odysee cookie cannot be sent directly to a node on another origin.
The local/SSR server therefore exposes same-origin routes under
`/$/api/hyperbeam-auth-device/v1/*`. It extracts the cookie and forwards only the
required request carrier.

`auth-hook@1.0` delegates to `odysee-auth@1.0`, which maps the session to account
authority, derives signing material, and removes token fields before a message is
signed or stored. Production deployments may route directly when the browser and
node share the required origin/auth boundary.

### Static Manifest Publishing

The frontend can also produce an Arweave path manifest. This is an optional
distribution format, not a replacement for SSR auth/upload bridges.

```bash
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
```

See [`RUN_DEMO.md`](RUN_DEMO.md) for the complete node and manifest launch
sequence.

## Current limitations

The development request console shows:

- browser-to-SDK and browser-to-SSR requests;
- HyperBEAM device request/response events;
- native auth and cache activity;
- observed device call counts;
- real store/backend relationships;
- selected-request traces and normalized visible claims.

Known graph nodes remain visible when inactive and are dimmed. Device counts and
edges must come from observed events, not inferred page content. Generic
`~query@1.0` and `~search@1.0` are separated from Odysee/LBRY product devices.

Useful process/listener checks:

```bash
ss -ltnp | rg ':(7700|9090|18785)\b'
pgrep -af 'meilisearch|rebar3.*device|dev-web-server|web/index.js'
```

Avoid starting duplicate frontend supervisors. If a request unexpectedly reaches
a compatibility service, inspect the selected trace to determine which device or
store made the call rather than patching the React page.

## Current Limitations

- Odysee fuzzy search depends on a running, populated Meilisearch index.
- Historical claim discovery still depends on Chainquery/Lighthouse-compatible
  data imported into that index.
- Comments are node-native only. Root, reply, edit, and author-delete flows are
  implemented; advanced moderation, creator reactions, and mutable comment
  settings remain intentionally unsupported rather than falling back to a
  legacy service.
- Native video/comment reactions and immutable public playlist snapshots are
  implemented. Mutable playlist-head/reference behavior remains deferred.
- Native free follows and notification preferences are implemented. Legacy
  import, aggregate counts, paid memberships, and the complete Following feed
  remain separate work.
- Complete mutable-name and claim-ID migration to owner-controlled reference
  messages is not finished.
- Claim-output transaction verification alone does not prove inclusion in the
  canonical chain. Header/MMR support exists, but full continuously attested
  chain-tip verification is not complete.
- TEE-tail and MMR-genesis attestation paths in `lbry-header@1.0` are not yet
  implemented.
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
