# Odysee on HyperBEAM Agent Guide

This repository implements Odysee as a standalone OTP application on a pinned
upstream HyperBEAM dependency. The store-first architecture on the current
branch is the source of truth.

## Start here

Before changing code:

1. Read the root `README.md`.
2. Read `docs/architecture.md` and the relevant file under `decisions/`.
3. Read `odysee-frontend/AGENTS.md` before changing browser behavior.
4. Inspect `git status` and preserve unrelated user changes.
5. Identify whether the change belongs in a source store, the single LBRY
   verifier, generic write/query configuration, or the frontend integration
   boundary.

Do not infer architecture from older master/Rave snapshots. If they conflict,
the standalone Ayush/store-first implementation, its decision records, and the
current tests win. Add other-branch capabilities only when they are genuinely
missing and can be expressed without replacing these contracts.

## Repository map

| Path | Ownership |
| --- | --- |
| `src/` | Standalone backend application, source stores, verification modules, node helpers, and manifest publisher. |
| `rebar.config` | Pinned upstream HyperBEAM dependency and build configuration. |
| `config.json` | Cookie-auth, match-index, stores, and manifest-hook demo configuration. |
| `odysee-frontend/` | Static React application and the sole frontend integration boundary. |
| `docs/` | Maintained architecture and operator documentation. |
| `decisions/` | Durable architectural decisions. |
| `patches/` | Minimal upstream patches that cannot live in this application. |
| `RUN_DEMO.md` | Working local launch and end-to-end examples. |

There is no tracked `hyperbeam/` fork. Never recreate it for an application
change. HyperBEAM source is an upstream dependency under `_build/*/lib/hb` and
is read-only except when deliberately updating a narrow documented patch.

## System contract

```text
Static manifest browser
    -> generic HyperBEAM HTTP/message/query routes
    -> local cache or store-first Odysee/LBRY sources
    -> verified immutable evidence
```

- Historical Odysee services are locators or byte sources behind stores.
- Native uploads, profiles, comments, reactions, playlists, subscriptions, and
  revisions are generic committed messages written through the stage-scoped
  `/id?0.%21=true&committers=all` route and discovered with `query@1.0`.
- Production uses the manifest frontend served by the node. Do not introduce a
  required SSR/proxy product path.
- Browser product code must not call Commentron, Lbryio, the SDK proxy,
  Lighthouse, Meilisearch, recommendations, geo, or other Web2 services as an
  alternate data mode.

## Architectural invariants

1. **Upstream HyperBEAM is a dependency.** Keep product code in this
   application; do not vendor or casually patch the runtime.
2. **Reads are stores.** Historical resolution and media reads go through the
   configured store stack and generic cache/message routes.
3. **Writes are generic committed messages.** Do not add application upload,
   comment, account, reaction, playlist, subscription, or moderation devices when a signed message plus
   exact query expresses the contract.
4. **One LBRY commitment device.** `lbry@1.0` verifies every evidence kind.
   Do not restore the old family of per-kind codec devices.
5. **Immutable reads are exact.** An immutable ID or outpoint must return that
   object, never a mutable current replacement.
6. **Names are locators.** URI and claim-ID resolution may change; the resolved
   evidence has an immutable identity.
7. **Discovery returns locators.** Query/search results are hydrated separately
   by immutable read.
8. **Source bytes fail closed.** Recompute transaction and SHA-384 identities
   before serving or caching evidence.
9. **Credentials are request-only.** Never persist cookies, tokens, private
   keys, or auth carriers in a public message.
10. **Native state is append-only.** Edits, deletes, reactions, moderation, and
    metadata updates need signed revisions/events, not mutation.
11. **Indexes are not authority.** Match/full-text indexes locate messages;
    committed messages and verified source evidence remain authoritative.
12. **Observed diagnostics report reality.** Do not fabricate devices, calls,
    backends, or verification state.
13. **Search controls stay server-side.** Product filters, sort order, limit,
    and offset are mapped in the frontend integration layer and sent through
    generic `search@1.0`; never post-filter ranked pages in React.

1. **Immutable reads are ID-first.** A read for an immutable ID returns that
   exact object. It must never silently resolve to an unrelated current claim
   version.
2. **Discovery returns locators.** Exact query and full-text search return IDs
   or paths. Callers hydrate objects separately through normal store reads and
   preserve the returned order.
3. **Generic devices stay generic.** Upstream-style `query@1.0`, `search@1.0`,
   `cache@1.0`, `auth-hook@1.0`, and message `/id` behavior must remain reusable.
   Do not add Odysee ranking, moderation, grouping, pagination, hydration, or
   compatibility semantics to them.
4. **Product behavior belongs in narrow devices.** Odysee contracts and legacy
   normalization belong in explicit Odysee devices. Do not recreate a broad
   SDK proxy device.
5. **Source formats stay separate from product semantics.** LBRY transaction,
   claim, descriptor, blob, attestation, and header verification belongs in
   LBRY codecs and core libraries, not in React or product adapters.
6. **Stores source objects; devices implement behavior.** A store may locate,
   normalize, verify, and return an object. It must not become a second
   playback, search, or UI adapter.
7. **Hydration has one integration boundary.** SDK-compatible claim shape,
   Redux ingestion, merged legacy/native lists, deduplication, and stable sort
   belong in the frontend integration layer, not in page-specific fixes.
8. **Credentials are request-only.** Cookies, auth tokens, private keys, and
   credential carriers must be stripped before public messages are signed,
   cached, indexed, or persisted.
9. **Indexes are not sources of truth.** Chainquery and Meilisearch discover
   objects. Native messages and verified source evidence remain authoritative.
10. **Native state changes are append-only.** Comment edits, comment controls,
    upload metadata updates, deletes, and mutable references create signed new
    state or revisions; they do not mutate immutable messages.
11. **Native social writes use generic messages.** Comments, reactions, public
    playlists, and follows/subscriptions are committed through `/id?!` and
    discovered with `query@1.0`; do not add product write devices or legacy API
    fallbacks for these flows.
12. **Compatibility sourcing remains observable.** Weaker player-proxy or
    legacy-source boundaries must be represented honestly in response metadata
    and diagnostics.
13. **Observed diagnostics report reality.** Debug graph activity, call counts,
    edges, backends, and stores must come from actual request events. Never add
    fictitious nodes, inferred calls, or hardcoded active paths.

## Change Ownership

Use this ownership table before implementing a fix:

| Concern | Correct location |
| --- | --- |
| LBRY evidence construction or verification | `src/dev_lbry*.erl` and their supporting modules. |
| Historical lookup, playback bytes, cache warming, or source normalization | `src/hb_store_*.erl` and `src/hb_odysee_*.erl`. |
| Node store stack, cookie hook, match index, or manifest publishing | `src/hb_odysee_node.erl`, `src/hb_odysee_ui.erl`, and `config.json`. |
| Generic local full-text behavior | `src/dev_search.erl` and `src/hb_search.erl`. |
| Browser routing, hydration, upload/comment messages, and SDK-shaped Redux adaptation | `odysee-frontend/ui/lbry.ts`, `ui/util/hyperbeam.ts`, and related services. |
| Rendering only | React components. |

Do not fix a store or identity defect in a page component. Search for existing
helpers before creating another transport or normalization path.

## Native identity and writes

The native browser identity is the node's `secret-*` cookie, minted by
`cookie@1.0` on the first committed write. Local storage contains display
metadata only and grants no authority.

Uploads:

- Post raw bytes to `/id?0.%21=true&committers=all`.
- Write a generic `odysee-upload@1.0` index message linking metadata to the
  immutable data ID.
- Resolve/list uploads through the match index and exact immutable reads.
- Never enter the legacy transcode/TUS path in HyperBEAM mode.
- Never persist browser `File` or transient pipeline objects.

Comments:

- Write roots and replies as ordinary committed messages.
- Discover them through one target-wide `query@1.0/only` request.
- Hydrate and verify each exact immutable ID and derive ownership from its
  committer.
- Edits and author deletes are contiguous, same-owner append-only revisions.
- A claimed profile is displayable only when its profile message verifies
  under the same committer.
- Do not silently fall back to Commentron or legacy APIs.

Reactions:

- Video and comment likes/dislikes are generic `odysee-reaction@1.0` messages.
- Discover paths with exact `query@1.0/only`, then hydrate and verify each
  immutable message and committer.
- Treat toggles, switches, and removals as contiguous append-only revisions
  linked by stable reaction/version references.
- Project at most one current reaction per verified committer and target;
  duplicate roots must not inflate counts.
- Never derive authority from claimed profile or channel fields and never call
  the legacy reaction API.

Playlists:

- Public playlists are generic `odysee-playlist@1.0` messages, not LBRY
  collection claims and not a custom device.
- Store ordered immutable native IDs or legacy outpoints only. Resolve local
  draft URIs before publish; never persist mutable claim IDs as item identity.
- The pinned external `reference@1.0` init commitment supplies the stable
  public playlist ID. Republish writes a new immutable full snapshot and a
  strictly newer same-owner set message while preserving the public URL.
- Hydrate and verify every init, set, and selected snapshot. Authority comes
  from the init commitment's committer; reject foreign writers, stale or tied
  updates, and snapshots owned by another committer.
- Keep Queue, Watch Later, Favorites, and unpublished drafts local. Do not
  restore channel selection, URL names, bids, confirmations, support, or
  `collection_*` SDK calls. Public deletion remains deferred.

Subscriptions:

- Free channel follows are generic `odysee-subscription@1.0` messages, not
  paid memberships and not a custom device.
- Bind the deterministic `subscription-ref` to the verified cookie committer
  and a stable native profile ID or full legacy channel claim ID.
- Follow, notification-preference update, unfollow, and re-follow are
  contiguous same-owner revisions. Reject gaps, forks, foreign writers, and
  conflicting semantic duplicates.
- Redux/local storage is only an optimistic cache; hydrate the authoritative
  list from exact verified node messages whenever the active account changes.
- A future one-time legacy import may write roots with explicit import
  provenance, but normal list/toggle flows must never call the legacy
  subscription API or wallet sync.

Advanced moderation remains unimplemented and must follow the same generic
message/event pattern and explicit authority checks.

## Frontend rules

- `ODYSEE_HYPERBEAM_NODE_API` selects the node; it is not a Legacy/HyperBEAM
  mode switch.
- Install the host-level legacy fetch guard before application imports.
- Manifest builds use hash routing, relative assets, and node-safe content
  types.
- Bare native `lbry://<name>` resolution uses the upload index and immutable
  hydration.
- Cookie-sensitive writes must use the same site/origin as the manifest.
- Keep account signup name-only: no email, password, or Web2 account call.

### Search and query

Keep these surfaces distinct:

- `query@1.0`: generic exact structured discovery over stored messages.
- `search@1.0`: generic full-text discovery for arbitrary HyperBEAM messages and
  the only fuzzy-search device used by Odysee.

Odysee search filters and sort options must reach `search@1.0`; browser
post-filtering breaks ranking and pagination. Search responses expose ordered
immutable locators, and hydration happens afterward. Indexing or deleting a
Meilisearch document must not mutate the underlying object.

### Comments and moderation

- New comments are signed native messages written through the generic ID path.
- One target-wide `query@1.0/only` discovery request should find native comment
  paths; product logic handles hydration, valid revision selection, hierarchy,
  counts, sorting, moderation, historical merging, and pagination.
- Edits are append-only revisions with `revision-of`, `previous-version`, and a
  monotonic revision number. Accept only contiguous, same-owner, signature-valid
  chains.
- Channel-owner hide, pin, creator-heart, and creator-channel-block actions are
  append-only `odysee-comment-control@1.0` messages. Apply only the latest valid,
  authorized control state.
- Historical comments and controls remain behind `odysee-comment@1.0`; browser
  code must not call Commentron directly.

### Reactions

- Video and comment reactions are generic `odysee-reaction@1.0` messages.
- Query only returns locators. Hydrate and verify each exact message and derive
  ownership from its selected commitment's committer.
- Toggle, switch, and removal operations are contiguous append-only revisions.
  Reject forks and conflicting semantic duplicates, and project at most one
  active reaction per committer and target.
- Browser actions must not call the legacy reaction API.

### Playlists

- Public playlists are immutable `odysee-playlist@1.0` snapshots written through
  the generic committed-message path, not LBRY collection claims or a custom
  device.
- Playlist items are ordered immutable native IDs or legacy outpoints. Resolve
  draft URIs before publishing and reject mutable claim IDs as stored identity.
- Editing a published playlist remains local until the user explicitly publishes
  another independent snapshot with a new message ID and share URL.
- Queue, Watch Later, Favorites, and unpublished drafts remain local. A stable
  mutable playlist reference is deferred until the canonical reference-device
  contract is available.

### Follows and subscriptions

- Free channel follows are generic `odysee-subscription@1.0` messages written
  through the generic committed-message path, not the legacy subscription API
  or a custom device.
- Follow, notification-preference updates, unfollow, and re-follow form one
  contiguous same-owner append-only revision chain bound to a stable channel
  reference.
- Query results are locators. Hydrate and verify each exact message, derive the
  owner from its commitment committer, and accept profile display metadata only
  when the profile verifies under that same committer.
- Legacy subscription import, aggregate subscriber counts, paid memberships,
  and Following-feed aggregation are separate contracts.

### Uploads and thumbnails

- `odysee-upload@1.0` owns authenticated chunks, manifests, metadata records,
  listing, updates, deletes, reconciliation, and native search indexing.
- Metadata changes and deletes create new state while retaining immutable media
  and history.
- Thumbnail bytes use signed generic `cache@1.0/write`. The SSR server holds
  `HYPERBEAM_CACHE_WRITER_JWK`; the browser never receives it. Its address must
  be trusted in the node's `cache_writers` option.

### Authentication

- The normal request hook is `auth-hook@1.0` with `odysee-auth@1.0` as the Odysee
  secret provider.
- Same-origin SSR bridges exist where browser cookies cannot cross origins or a
  server-held signer is required. They are transport/security boundaries, not a
  second data mode.
- The internal compatibility subscription implementation is not the native
  follow write path. The public/frontend subscription-count surface remains
  `odysee-account@1.0`; native follows are generic committed messages.

## Local Services

The normal local stack is:

| Service | Address | Purpose |
| --- | --- | --- |
| Meilisearch | `http://127.0.0.1:7700` | Odysee claim-search index |
| HyperBEAM | `http://127.0.0.1:18785` | Runtime, devices, and stores |
| Frontend SSR | `http://localhost:9090` | Browser application and same-origin bridges |

Start Meilisearch from its sibling checkout when needed:

```sh
../meilisearch/target/release/meilisearch --http-addr 127.0.0.1:7700
```

Build and start HyperBEAM:

```sh
cd hyperbeam
HOME=/tmp/odysee-hb-home rebar3 as hyperbeam compile
HOME=/tmp/odysee-hb-home HB_PORT=18785 rebar3 device local
```

Install and start the frontend:

```sh
cd odysee-frontend
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18785 pnpm run dev:web-server
```

Keep required services running while the user tests. If a required service
dies, restart it promptly and verify its listener. Run only one frontend
`dev:web-server` supervisor; duplicate asset watchers can terminate or race the
SSR child process.

Useful health checks:

```sh
curl http://127.0.0.1:7700/health
curl http://127.0.0.1:18785/~meta@1.0/info
curl -I http://127.0.0.1:9090/
ss -ltnp | rg ':(7700|9090|18785)\b'
pgrep -af 'meilisearch|rebar3.*device|dev-web-server|web/index.js'
```

Never commit credentials. Chainquery access is read-only for the importer, and
Meilisearch credentials belong in environment variables. Use the documented
checkpoint/staging-index rebuild flow rather than bulk-rebuilding a live index
in place.

## Validation Requirements

Complete the full affected workflow, not only the narrow function that changed.
Choose the broadest practical checks for the touched boundary.

Backend baseline:

```sh
rebar3 compile
HB_PORT=0 rebar3 eunit
rebar3 device test --with-core
```

Frontend baseline:

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

Run the cookie-owned browser lifecycle against a configured node when auth,
uploads, or comments change:

```sh
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-reactions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-playlists
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-subscriptions
```

Always run `git diff --check`. Report skipped, timed-out, or environment-blocked
tests plainly; a compile or unit test alone does not prove the browser flow.

## Documentation and Git hygiene

- Update `README.md`, `docs/`, `decisions/`, and this guide when architecture,
  ownership, public operations, identity, configuration, or validation changes.
- Preserve unrelated user changes in a dirty worktree.
- Do not commit credentials, generated manifests, build output, dependency
  trees, caches, logs, or local node keys.
- Do not create commits unless the user asks.
- Do not rewrite or force-push shared history.
- Remove obsolete experimental artifacts while leaving unrelated files alone.
