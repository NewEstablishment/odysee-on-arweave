# Odysee Frontend Component Guide

This directory is the Odysee browser and SSR application. Its product data path is HyperBEAM. Legacy Odysee services may still supply data, but only behind HyperBEAM devices or stores.

## Routing Contract

- `ODYSEE_HYPERBEAM_NODE_API` is required for the integrated application.
- There is one request wiring mode. Do not add a Legacy/HyperBEAM switch, mode storage key, mode query parameter, or browser-side original-network fallback.
- `ui/lbry.ts` is the SDK-shaped facade. Routed content, account, comment, search, playback, and upload operations go to HyperBEAM. Local wallet/daemon-only operations may retain their existing SDK route until a real HyperBEAM contract replaces them.
- `ui/util/hyperbeamRouting.ts` defines the allowed public/read and trusted-write device surfaces.
- Legacy data compatibility belongs in HyperBEAM devices and stores, not in React, Redux, or direct browser fetches.

## Identity And Hydration

Search and query responses are ordered locators, not claim objects. Hydrate each locator through generic HyperBEAM reads and normalize the result at the integration boundary.

- Native content uses immutable HyperBEAM IDs.
- Legacy immutable claim outputs use `txid:nout`.
- Legacy claim IDs are mutable compatibility/reference identifiers.
- Channel pages and upload pages must merge native and historical entries, deduplicate by stable identity, and sort the combined set rather than prepending one source.
- Playback should prefer immutable outpoints and route through `~odysee-stream@1.0`.

## Auth And SSR Bridges

Native accounts are node cookies: signup commits a name-only channel message, `cookie@1.0` mints the `secret-*` cookie, and subsequent comments use the same signer. The browser and node must use matching hostnames in local development so the cookie is same-site. Odysee compatibility auth still uses the Koa routes under `/$/api/hyperbeam-auth-device/v1/*`.

The SSR routes are transport/auth/upload/thumbnail bridges, not a second data mode. Production should use same-origin HyperBEAM where possible, while preserving these routes where browser cookie or server-held signer boundaries require them.

Thumbnail upload uses a server-held `HYPERBEAM_CACHE_WRITER_JWK` to sign generic `~cache@1.0/write`. The browser does not receive that key. The signer address must be trusted by the node's `cache_writers` configuration.

## Comments

The `Comments` facade in `ui/comments.ts` always calls HyperBEAM helpers. It must not call Commentron directly.

- Native roots, replies, and revisions write separate `odysee-comment-index@1.0` locator records. Stock `~query@1.0/only` discovers those locators, and each signed comment is hydrated and verified by its exact immutable `data-id`.
- Product logic performs deduplication, revision-chain selection, hierarchy construction, counts, sorting, moderation projection, and pagination.
- The active comment flow does not query or write Commentron and does not merge historical comments.
- Native edits and controls are append-only; never mutate a stored comment.
- Channel thumbnails and author URIs must tolerate native normalized comment identities without passing an ID-only string to the LBRY URI parser.

## Search

There are two distinct surfaces:

- `~query@1.0`: exact local message discovery, currently used by native comments and controls.
- `~search@1.0`: generic HyperBEAM full-text search primitive and the sole fuzzy-search path used by Odysee.

Normal Odysee search uses `~search@1.0`, receives ordered immutable IDs, hydrates them through stores, and preserves the search order. Filters, sort, upload date, claim type, and media type must reach the search device rather than being reapplied as unrelated browser-only filtering.
The SSR public-store batch hydrator reads result IDs concurrently, expands the
required immutable `value` and `thumbnail` links server-side, and keeps a
bounded cache of successful immutable reads. Do not move this product hydration
work into the generic search device.

## Homepage

The private homepage repository supplies category rules, mutable channel IDs,
and pinned mutable claim IDs only. The SSR homepage materializer records each
resolvable source channel as an `immutableChannelId`, reports stale source
channel IDs separately, resolves each selected row item to an immutable native
ID or legacy outpoint, and performs direct HyperBEAM reads for all resolved
signing channels and selected media. The full immutable source-channel list is
provenance and future native-discovery input; it is not reread in full on every
refresh. The materializer atomically publishes a persistent snapshot only after
every visible media object and its resolved signing channel are cached.
Deployment must refresh the private homepage source checkout before running the
materializer. Dynamic media discovery is bounded below by source timestamp and
above by release time, then rejects stale or future release times locally;
explicit curated pins retain their configured placement.

The homepage API returns channel provenance, ordered media `immutableIds`, and
the immutable signing-channel ID associated with each media ID.
`buildHomepage.ts` converts media IDs to immutable URIs, and
`ClaimTilesDiscover` batch-hydrates media and signing channels without issuing
browser claim searches or resolving mutable pins. Homepage tiles must navigate
to `/$/id/<immutable-id>`; a legacy canonical URI is display metadata, not the
navigation identity. Keep `CUSTOM_HOMEPAGE_SNAPSHOT_FILE` on persistent writable
storage outside the deployment checkout. Production deployment must complete
`pnpm run homepage:materialize` before restarting the web process. The existing
process continues serving the last valid snapshot while a replacement is built,
and the materializer atomically publishes the replacement only after validation
and cache warming succeed. Request handling only reads the published snapshot
and must never trigger materialization. Production automation periodically
refreshes stale snapshots using the same atomic promotion without restarting the
frontend. A production custom-homepage build must
wait for materialized category data instead of briefly rendering the built-in
personalized fallback; local development may retain that fallback when no custom
homepage exists.
The SSR root document injects a compact, all-locale locator view of the last
valid materialized homepage before the application bundle runs, so a reload
never waits for the homepage API before selecting the user's locale. It must not
embed claim payloads or persist a second browser object store. Immutable objects
hydrate through HyperBEAM batch reads into the normal in-memory/Redux path.
Media hydration must reach Redux as soon as the immutable batch read succeeds.
Signing-channel, active-livestream, or other optional enrichment must never gate
rendering the resolved media rows. A failed immutable read must remain unresolved
and must not fall through to mutable name or claim-ID resolution.
Materialized homepage rows hydrate only their rendered `pageSize`. Near-viewport
rows receive priority in a bounded queue, while off-screen rendered rows continue
hydrating in the background and must not compete concurrently with visible media
and signing-channel reads.
Channel-targeted discovery, including Following, must not wait on a duplicate
upload-list request. Historical results return through claim search; native
uploads merge through the established Redux integration stage.
Internal featured-banner targets are materialized and routed by immutable ID too.

## Debug Console

The console reports the single HyperBEAM request path. Its graph always shows known nodes, with inactive nodes dimmed and call counts derived only from observed events.

- Odysee product devices are one group.
- Generic HyperBEAM-provided `~query@1.0` and `~search@1.0` are visibly separated from product devices.
- Search evidence draws `~search@1.0 -> Search index` only when an actual generic search request is observed.
- Edges are derived from observed request/store/backend relationships and connect actual node bounds.
- Legacy Odysee API, Chainquery, Blobcache, Meilisearch, cache/store, and media nodes represent real backing components only.
- The minimized header contains only `Odysee request log`.

## Static Manifest Build

`pnpm run build:manifest` builds and validates a path-manifest-compatible frontend. Manifest builds use hash routing and relative assets. Normal SSR builds continue to use `index-web.html` and BrowserRouter. Authenticated features still need equivalent same-origin proxy/node contracts.

Release checks:

```sh
pnpm run typecheck:tsc
pnpm run test:static-manifest
pnpm run build:manifest
```

## Local Operation

```sh
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://localhost:18785 pnpm run dev:web-server
```

The local SSR server normally listens on `9090`. Meilisearch normally listens on `127.0.0.1:7700`; HyperBEAM normally listens on `18785`.

Validation for integration changes:

```sh
pnpm run typecheck:tsc
pnpm run fmt:check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Use the focused native comment, control, upload, static-manifest, and browser smoke scripts when their surfaces change.

## Current State And Limitations

- The browser-side legacy wiring switch and compatibility-read toggle are retired.
- Search and query produce locators and hydrate separately; do not regress to passing backend search documents directly into Redux.
- Reactions and several advanced moderation/settings operations are not yet available for the native cookie account.
- Meilisearch must be running and populated for fuzzy search. It is not a source of truth.
- The normal SSR deployment remains necessary for local auth bridges and server-held cache signing.
- Recommendations and local wallet operations have separate contracts and should not be mislabeled as normal search or browser legacy mode.

Update this file whenever routing ownership, integration contracts, environment variables, validation, or known limitations change.
