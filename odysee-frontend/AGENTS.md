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

Local browser cookies cannot be sent to a HyperBEAM node on another origin. The Koa server therefore exposes same-origin routes under `/$/api/hyperbeam-auth-device/v1/*`; it reads the cookie, forwards only the required auth carrier, and leaves token stripping/signing to HyperBEAM auth.

The SSR routes are transport/auth/upload/thumbnail bridges, not a second data mode. Production should use same-origin HyperBEAM where possible, while preserving these routes where browser cookie or server-held signer boundaries require them.

Thumbnail upload uses a server-held `HYPERBEAM_CACHE_WRITER_JWK` to sign generic `~cache@1.0/write`. The browser does not receive that key. The signer address must be trusted by the node's `cache_writers` configuration.

## Comments

The `Comments` facade in `ui/comments.ts` always calls HyperBEAM helpers. It must not call Commentron directly.

- Native roots, replies, revisions, and owner controls are discovered through stock `~query@1.0/only` and hydrated by immutable ID.
- Product logic performs deduplication, revision-chain selection, hierarchy construction, counts, sorting, moderation projection, and pagination.
- Historical Commentron data is accessed through `~odysee-comment@1.0` and merged at the integration boundary.
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
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18785 pnpm run dev:web-server
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
- Native and legacy comments are merged, but historical data still depends on the HyperBEAM Commentron adapter.
- Meilisearch must be running and populated for fuzzy search. It is not a source of truth.
- The normal SSR deployment remains necessary for local auth bridges and server-held cache signing.
- Recommendations and local wallet operations have separate contracts and should not be mislabeled as normal search or browser legacy mode.

Update this file whenever routing ownership, integration contracts, environment variables, validation, or known limitations change.
