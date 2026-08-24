# Odysee on HyperBEAM

This monorepo runs the Odysee web application through HyperBEAM. It combines a
HyperBEAM runtime extended with Odysee/LBRY integration devices and the Odysee
browser/SSR application that consumes those devices.

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
Browser UI
   |
   | SDK-shaped calls, direct immutable reads, media requests
   v
Odysee frontend integration (`ui/lbry.ts`, `ui/util/hyperbeam.ts`)
   |
   | same-origin SSR bridge where cookies or server-held keys are required
   v
HyperBEAM router/runtime
   |
   +-- generic devices: query, search, cache, auth-hook
   +-- Odysee devices: claim, stream, account, comment, upload, search, ...
   +-- LBRY codecs: transaction, claim, descriptor, blob, attestation, ...
   |
   v
Store stack
   |
   +-- local immutable cache/store
   +-- Odysee/LBRY source stores
   +-- remote HyperBEAM nodes
   +-- Arweave/gateway stores
   |
   v
Compatibility sources: Odysee API, LBRY SDK proxy, Chainquery,
Commentron, blobcache/player services, Meilisearch
```

There are three device layers:

| Layer | Responsibility |
| --- | --- |
| Generic HyperBEAM | Reusable exact query, full-text discovery, cache, signing, and authentication primitives. |
| Odysee product devices | Product contracts and normalization of current or historical Odysee data. |
| LBRY evidence devices | Source-format codecs and cryptographic commitments for independently verifiable LBRY objects. |

The Odysee and LBRY layers are intentionally separate. An Odysee device may use
an LBRY commitment device, but a reusable LBRY codec must not acquire Odysee UI,
ranking, moderation, or API semantics.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `hyperbeam/` | HyperBEAM runtime, generic devices, Odysee adapters, LBRY codecs, stores, and verification libraries. |
| `hyperbeam/AGENTS.md` | Maintained runtime architecture, invariants, operations, and limitations. |
| `odysee-frontend/` | Odysee React application, Redux integration, SSR server, auth/upload bridges, playback, and diagnostics. |
| `odysee-frontend/AGENTS.md` | Maintained browser/SSR routing and hydration contracts. |
| `scripts/import-chainquery-meili.mjs` | Resumable Chainquery-to-Meilisearch importer and index rebuild tool. |
| `scripts/import-chainquery-meili.test.mjs` | Importer normalization, filtering, checkpoint, and rebuild tests. |
| `../lighthouse/` | Optional sibling checkout of [OdyseeTeam/lighthouse](https://github.com/OdyseeTeam/lighthouse), used only to compare legacy search schema, filters, and ranking. It is not runtime code. |
| `../meilisearch/` | Sibling Meilisearch source checkout used to build the local search backend. It is not part of this monorepo. |
| `AGENTS.md` | Monorepo-wide engineering and documentation rules. |

The component `AGENTS.md` files are the concise maintained references. This
README is the full system orientation for a new contributor or agent.

## Identity Model

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
| `lbry@1.0` | Umbrella verifier and content-type/hint dispatcher for the LBRY commitment family. |
| `lbry-blob@1.0` | Encodes, decodes, and verifies encrypted blob bytes against their SHA-384 blob ID. |
| `lbry-stream-descriptor@1.0` | Encodes, decodes, and verifies raw stream descriptor JSON against its `sd_hash`, then exposes the descriptor's stream metadata. |
| `lbry-transaction@1.0` | Encodes, decodes, and verifies raw transaction bytes against the display-order transaction ID. |
| `lbry-claim@1.0` | Encodes, decodes, and verifies a protobuf claim extracted from one specific transaction output. |
| `lbry-channel@1.0` | Specializes a verified claim output as a channel and preserves the secp256k1 public key required for attestations. |
| `lbry-stream@1.0` | Specializes a verified claim output as a stream and commits its descriptor/source relationship. |
| `lbry-channel-attestation@1.0` | Verifies the channel signature binding a stream claim, signing channel, and source descriptor hash. |
| `lbry-claim-output@1.0` | Bridges `odysee-claim-proof@1.0` output into the LBRY-native commitment family. Exposes `commit`, `verify`, and `to-hint`. Source: `src/preloaded/odysee/dev_lbry_claim_output.erl`. |
| `lbry-header@1.0` | Verification-only device for header chunks, MMR membership proofs, and MMR consistency proofs against a configured root. |

## Stores

Stores implement source lookup and immutable reads; devices implement behavior.
Do not create a second playback adapter inside a store.

| Store | Scope and contract |
| --- | --- |
| `hb_store_odysee` | Read-only compatibility source. Resolves typed Odysee paths for claims, channels, comments, reactions, counts, transactions, claim outputs, descriptors, and blobs, then returns normalized committed messages. `write`, `group`, and `link` are intentionally read-only errors. |
| `hb_store_lbry_blob` | Fetches bytes from configured blob servers by SHA-384 hash and refuses mismatched content. |
| `hb_store_lbry_stream_descriptor` | Reads the descriptor blob through `hb_store_lbry_blob`, parses it, and verifies the requested descriptor hash. |
| `hb_store_lbry_transaction` | Fetches raw transaction data through the SDK proxy and recomputes the transaction ID before returning it. |
| `hb_store_lbry_claim_output` | Reads immutable `<txid>:<nout>` objects, verifies the source transaction/output, specializes channel/stream claims when requested, and can walk create/update ancestry. |

The default node store stack begins with local storage/cache and uses remote or
compatibility stores only when the object is absent. A successful source read can
therefore be cached as its normalized immutable representation without making the
legacy source the object identity.

## LBRY Verification Libraries

The codec devices are deliberately thin. Their cryptographic and binary-format
work is implemented in `hyperbeam/src/core/lib/`:

| Module | Responsibility |
| --- | --- |
| `hb_lbry_ancestry` | Builds and verifies signed create/update ancestry for a claim. |
| `hb_lbry_attestation` | Normalizes secp256k1 keys and verifies channel/stream signatures. |
| `hb_lbry_bridge` | Composes stores into high-level transaction, claim-output, descriptor, blob, range, and stream reconstruction operations. |
| `hb_lbry_claim_proto` | Decodes LBRY claim protobuf metadata, including stream descriptor hashes and channel keys. |
| `hb_lbry_commitment` | Creates and verifies native HyperBEAM commitment messages and IDs for LBRY evidence. |
| `hb_lbry_mmr` | Implements SHA256d, Merkle/MMR primitives, membership proofs, and consistency proofs. |
| `hb_lbry_proxy` | Calls the LBRY SDK proxy for resolve, search, and raw transaction sourcing. |
| `hb_lbry_stream_descriptor` | Parses descriptors, hashes blobs, decrypts chunks, computes sizes, and reconstructs streams/ranges. |
| `hb_lbry_tx` | Parses raw transactions, calculates transaction IDs/hash160, decodes claim envelopes, and implements LBRY signature hashing. |

## Frontend and SSR Integration

The frontend preserves the existing Redux/component application while replacing
its product transport boundary.

| File or area | Responsibility |
| --- | --- |
| `odysee-frontend/ui/lbry.ts` | SDK-shaped facade used by existing actions. It routes supported product calls to HyperBEAM without exposing transport details to every component. |
| `ui/util/hyperbeamRouting.ts` | Allowlist and routing ownership for public reads and trusted writes. |
| `ui/util/hyperbeam.ts` | Request construction, immutable hydration, claim merging, query/comments integration, and normalized response conversion. |
| `ui/comments.ts` | Comment facade. Native query/write behavior and historical Commentron access both remain behind HyperBEAM. |
| `ui/services/hyperbeamUpload.ts` | Browser-side chunking/upload orchestration and native upload metadata requests. |
| `ui/services/thumbnailUpload.ts` | Calls the same-origin server route that signs trusted cache writes. |
| `web/src/odyseeHyperbeamNode.js` | SSR-side HyperBEAM adapter for claim, search, stream, upload, and account calls. |
| `web/src/fetchStreamUrl.js` | SSR playback/media URL resolution. |
| `web/src/routes.js` | Same-origin auth, upload, thumbnail, media, and cache-signing bridges. |
| `ui/component/hyperbeamDebugConsole/` | Request trace, per-device graph, store/backend observations, and selected-request diagnostics. |

Local wallet/daemon-only methods may still use their existing local SDK contract
until a real HyperBEAM replacement exists. That is not a product legacy mode and
must not be used to bypass a device contract for network data.

## Feature Flows

### Claim Resolution and Hydration

1. A page requests a URI, claim ID, immutable outpoint, or search result locator.
2. The facade routes mutable URI/claim lookup to `odysee-claim@1.0` or performs a
   direct immutable read for a native ID/outpoint.
3. The local store/cache is checked first.
4. If necessary, `hb_store_odysee` or a dedicated LBRY store sources the object.
5. LBRY evidence is normalized and committed with the matching LBRY codec.
6. The frontend hydrates the result into the SDK-shaped claim representation used
   by Redux and components.

Channel and upload pages merge native and historical items, deduplicate by stable
identity, and sort the combined result. One source must not simply be prepended to
the other.

### Playback and Media

`odysee-stream@1.0` accepts mutable lookup inputs and immutable claim outputs. The
preferred path verifies the transaction output, extracts the descriptor hash,
verifies the descriptor and blob hashes, reconstructs the stream, and serves byte
ranges. Range support is required for seeking and normal browser video playback.

When complete source evidence is unavailable, the device can use the configured
Odysee player proxy. Such responses carry source/verification headers that make
the weaker boundary visible; the frontend does not silently invent verification.

### Search

Two search surfaces serve different purposes:

| Surface | Use |
| --- | --- |
| `query@1.0` | Exact structured discovery in HyperBEAM stores, such as comments and control messages. |
| `search@1.0` | Generic full-text discovery for arbitrary HyperBEAM messages and the sole Odysee fuzzy-search path. |

Odysee fuzzy search calls the unchanged `search@1.0` device directly. The node's
generic search configuration points it at the `hyperbeam_messages` index. The
index contains normalized fields needed for lexical matching, filtering, and
ranking, while each document's `id` is the immutable locator returned to the
caller.

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
`POST /id?0.%21=true&committers=all` path as native uploads. The node's
`cookie@1.0` identity commits each write; comments do not call Commentron or
require an LBRY channel signature. Their stable selectors include
`type=comment`, `target`, `parent`, and `schema=odysee-comment@1.0`.
New comment text is stored in the message `body`, so reading the immutable
message ID returns the comment document directly. Readers still accept the
older `comment` and `text` fields for compatibility.

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
written through `POST /id?0.%21=true&committers=all`. Exact `query@1.0/only`
selectors discover locators; the frontend then hydrates and verifies each exact
message and derives its owner from the selected commitment's committer.

Each committer has at most one projected reaction per target and subject.
Switches, removals, and toggles are append-only revisions linked by stable
reaction and version references. Projection accepts only contiguous same-owner
chains, stops at forks, and rejects conflicting copies of one semantic version.
Neither video nor comment reactions call the historical reaction API.

### Playlists

Public playlist contents are generic immutable `odysee-playlist@1.0` snapshot
messages. A snapshot contains ordered immutable native message IDs or legacy
`<txid>:<nout>` outpoints; local draft URIs are resolved before publishing and
mutable claim IDs are never stored as item identity. Query results are locators
that are hydrated and commitment-verified before display.

The first publish also creates a canonical `reference@1.0` init message whose
committed ID is the playlist's stable public ID. A later publish writes a new
full snapshot followed by an owner-signed reference set pointing to it. The old
snapshot remains immutable and independently addressable while the playlist URL
stays unchanged. Reference candidates are exact-query locators; each init/set
and selected snapshot is hydrated and verified, and only strictly newer updates
from the init committer are projected. Queue, Watch Later, Favorites, and
unpublished drafts stay local. Public deletion is not yet exposed.

### Follows and Subscriptions

Free channel follows are generic `odysee-subscription@1.0` messages written
through `POST /id?0.%21=true&committers=all`. The relationship identity combines
the verified cookie committer with a stable native channel ID or full legacy
channel claim ID.

Follow, notification-preference update, unfollow, and re-follow operations are
append-only revisions linked by `revision-of`, `previous-version`, and a
monotonic revision number. Discovery uses exact `query@1.0/only` selectors;
each locator is hydrated by immutable ID, commitment-verified, and attributed
to its exact committer. Forks, gaps, foreign writers, conflicting semantic
duplicates, and unverifiable profile claims fail closed. The browser does not
call the legacy subscription API. Provenance is committed as `source-system`
rather than `origin`, because HTTP `Origin` is request-only transport metadata.

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

Manifest builds use hash routing and relative assets. The build command validates
that the generated output remains path-manifest compatible.

## Trust and Verification Boundaries

- Native HyperBEAM messages are verified against their commitments and immutable
  IDs.
- Blob and descriptor stores verify requested SHA-384 hashes before returning
  bytes.
- Transaction stores recompute transaction IDs from raw bytes.
- Claim-output verification proves the selected output belongs to the supplied
  raw transaction and decodes its claim script.
- Channel attestations verify secp256k1 signatures against the channel key carried
  by a verified channel claim.
- `lbry-header@1.0` verifies configured MMR/header proofs, but full autonomous
  chain-tip/TEE attestation is not yet complete.
- Chainquery and Meilisearch are discovery/index inputs, not cryptographic truth.
  Their locators must be hydrated and verified through normal reads.
- Commentron and Odysee API responses are compatibility data normalized at device
  boundaries. Verification strength depends on the source fields available.
- Remote stores should use `verify-remote-read` and an expected codec before
  caching a response from another node.

## Configuration

### Frontend and SSR environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ODYSEE_HYPERBEAM_NODE_API` | Yes | Internal HyperBEAM node base URL used by browser integration and SSR. |
| `HYPERBEAM_BASE_URL` | No | External/preferred node URL when it differs from the internal API URL. |
| `HYPERBEAM_PLAYBACK_URL` | No | Explicit playback endpoint override. Otherwise the stream device URL is derived from the node base. |
| `HYPERBEAM_CACHE_WRITER_JWK` | For thumbnail writes | Server-only JWK used to sign `cache@1.0/write`. Never expose it in browser config. |
| `WEB_SERVER_PORT` | No | SSR server port; local default is `9090`. |
| `WEBPACK_WEB_PORT` | No | Frontend development port; local default is `9090`. |

The broader Odysee frontend still has existing service configuration in
`.env.defaults`. Do not interpret those URLs as permission for browser product
data to bypass HyperBEAM.

### HyperBEAM node options

These options can be set in node configuration or supplied to the relevant
device/store:

| Option | Purpose |
| --- | --- |
| `search-backend-url` | Generic search backend URL; default `http://127.0.0.1:7700`. |
| `search-api-key` | Generic search backend API key when required. |
| `search-index` | Generic index name; this project uses `hyperbeam_messages`. |
| `search-schema` | Fields accepted by generic `search@1.0/write`; `all` indexes every safe primitive field. |
| `search-*-timeout`, batching, and retry options | Generic search request, task polling, batching, and retry tuning. |
| `odysee-account-api` | Account identity endpoint used by `odysee-auth@1.0`. |
| `odysee-session-accounts` | Offline/local token-to-account mapping for tests or isolated operation. |
| `odysee-api-url` | Odysee API compatibility origin for account/count/reaction adapters. |
| `odysee-comment-url` | Commentron API origin. |
| `lbry-proxy-url` | LBRY SDK JSON-RPC proxy used for claim and transaction sourcing. |
| `lbry-player-server` / `lbry-player-proxy` | Compatibility playback source and whether proxy fallback is enabled. |
| `lbry-media-origin` | Origin used by media URLs. |
| `cache_writers` | Addresses allowed to perform trusted signed cache writes. |
| `store` | Ordered local, remote, Arweave, and Odysee/LBRY store stack. |

`odysee_claims` is the local staging index populated from the Chainquery slice.
`scripts/replay-meili-to-hyperbeam-search.mjs` submits those documents through
`search@1.0/write` into `hyperbeam_messages`; production ingestion follows the
same device boundary rather than making the staging index a runtime dependency.
For trusted maintenance of an already-populated target after a ranking/schema
change, `--direct-target` uses Meilisearch's bulk document API with the same
normalization and stable primary-key derivation. It bypasses only the node HTTP
rate limiter and is not a runtime ingestion or query path.

Replay validates each immutable locator against HyperBEAM before indexing it.
The hydrated claim identity and searchable title (or claim name when no title
exists) must match the source document, so stale cache representations and
codec regressions fail the import instead of producing misleading search
results. `--skip-hydration-check` exists only for isolated diagnostics and must
not be used for a deployed index.

## Local Development

### Prerequisites

- Erlang/OTP 27.
- `rebar3`.
- Native compilation tools required by HyperBEAM dependencies.
- Node.js `>=22.12.0`; `mise.toml` currently pins Node `22.22.3`.
- `pnpm@10.33.0`.
- Meilisearch for fuzzy Odysee search.
- MySQL client only when importing Chainquery.

### 1. Start Meilisearch

Use an installed Meilisearch binary or a container and listen on port `7700`:

```bash
meilisearch --http-addr 127.0.0.1:7700
```

Confirm it is alive:

```bash
curl http://127.0.0.1:7700/health
```

### 2. Build and start HyperBEAM

Create a config file that uses `hb_store_odysee`. You can modify to include other 
stores, but this is the minimum config needed.

```json
{
  "store": [
    {
      "ao-types": "store-module=atom,scope=atom",
      "store-module": "hb_store_odysee",
      "name": "cache-odysee"
    }
  ]
}
```

```bash
rebar3 compile
HB_CONFIG=config.json rebar3 odysee-local
```

When the config contains `port`, that value is authoritative. Use a copied
config with a different `port` for parallel nodes; `HB_PORT` does not override
the JSON value.

Keep the device process attached to a TTY during normal development. Confirm the
listener before starting the frontend:

```bash
curl http://127.0.0.1:18801/~meta@1.0/info
```

### 3. Install and start the frontend

```bash
cd odysee-frontend
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18801 pnpm run dev:web-server
```

Open `http://localhost:9090`. The development command runs the asset watcher and
SSR server together. Run only one `dev:web-server` supervisor; duplicate watchers
can race and terminate each other's child server.

### Two-node verifying-cache demo

The demo starts an Odysee source node and an edge/cache node that verifies remote
LBRY commitments before caching:

```bash
cd hyperbeam
NODE_A_PORT=19734 NODE_B_PORT=19735 ./scripts/odysee-two-node-demo.sh
```

Point the frontend at Node A to exercise remote source verification.

## Importing Chainquery into Meilisearch

Meilisearch must contain normalized historical claim documents for full legacy
search. The importer is read-only with respect to Chainquery.

Required source configuration:

```bash
export CHAINQUERY_HOST=chainquery.odysee.tv
export CHAINQUERY_USER=blobs-cleaner
export CHAINQUERY_PASS='...'
export CHAINQUERY_DB=chainquery
export MEILI_URL=http://127.0.0.1:7700
export MEILI_INDEX=odysee_claims
```

Use `MEILI_MASTER_KEY` or `ODYSEE_SEARCH_API_KEY` when Meilisearch requires a key.
Never commit database or search credentials.

Chainquery does not contain view or channel-subscriber counts. For ranking
imports, provide a request-only Odysee API token and enable the explicit
engagement enrichment pass:

```bash
export ODYSEE_API_AUTH_TOKEN='...'
```

The importer fetches view and subscriber counts in the same 1,000-item batches
used by Lighthouse, incorporates them into `search_rank`, and never stores the
token in a document or checkpoint.

Refresh engagement values on documents already present in an index without
rescanning Chainquery:

```bash
node scripts/import-chainquery-meili.mjs \
  --index hyperbeam_messages \
  --setup-settings \
  --refresh-engagement \
  --batch-size 1000
```

Inspect a small slice without writing:

```bash
node scripts/import-chainquery-meili.mjs --limit 100 --dry-run
```

Create/configure the index and import a resumable slice:

```bash
node scripts/import-chainquery-meili.mjs \
  --setup-settings \
  --enrich-engagement \
  --limit 10000 \
  --batch-size 1000 \
  --checkpoint-file /tmp/odysee-search-import.json
```

The importer supports ID-order and modified-time scans, exact/search-term slices,
checkpoints, and a staging-index rebuild/swap flow. A rebuild preserves native
HyperBEAM documents and reconciles legacy changes before swapping the staging
index into place. Do not bulk-rebuild the live target directly without the
checkpoint/staging flow.

## Testing

### HyperBEAM

Compile the runtime:

```bash
rebar3 compile
```

Run focused device tests with an ephemeral port:

```bash
HB_PORT=0 rebar3 eunit
rebar3 device test --with-core
```

LBRY codec/store changes should also run the relevant EUnit modules in
`src/core/test/` and device tests for the changed codec.

### Frontend

```bash
cd odysee-frontend
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Focused integration scripts include:

```bash
pnpm run test:hyperbeam-upload-smoke
pnpm run test:hyperbeam-query-comment-smoke
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
pnpm run test:native-message-verification
pnpm run test:native-comment-revisions
pnpm run test:native-comment-controls
pnpm run test:native-reactions
pnpm run test:native-playlists
pnpm run test:native-subscriptions
pnpm run test:static-manifest
```

Run the importer tests from the repository root:

```bash
node --test scripts/import-chainquery-meili.test.mjs
```

Use the broadest practical set for the changed boundary. Passing a narrow unit
test is not sufficient when a change affects stores, SSR normalization, Redux
hydration, or a full browser workflow.

## Diagnostics

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
- Native video/comment reactions and public playlists with immutable snapshots
  plus stable `reference@1.0` heads are implemented. Public playlist deletion
  remains deferred.
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
- Compatibility player-proxy playback is weaker than descriptor/blob-native
  verification and is labeled as such in response metadata.
- Some local wallet/daemon operations retain their local SDK contract until a
  concrete HyperBEAM device replaces them.
- A real TEE deployment requires an AMD SEV-SNP Linux host and the HyperBEAM OS
  stack; ordinary local development is not a TEE.

## Working on the Repository

Start with this README, then read the `AGENTS.md` in the component you will edit.
Before changing behavior, identify which boundary owns it:

- generic reusable discovery/storage behavior belongs in an upstream-style
  HyperBEAM device;
- Odysee product semantics belong in an Odysee device;
- LBRY format and cryptographic verification belong in a codec/core library;
- source lookup belongs in a store;
- hydration and UI state adaptation belong at the frontend integration boundary;
- rendering belongs in React components.

Do not solve a device/store bug with page-specific Redux state, and do not add
product semantics to `query@1.0` or `search@1.0`. Preserve immutable IDs, keep
private credentials out of persisted messages, update the relevant component
guide when a contract changes, and finish every change with focused tests plus an
end-to-end check of the affected flow.
