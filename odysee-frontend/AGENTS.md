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

The manifest frontend and HyperBEAM node are normally same-origin. The node's
`cookie@1.0` provider mints a browser identity on the first committed write;
later account, upload, and comment writes reuse that cookie without email,
password, an Odysee auth token, or an LBRY channel signature.

The SSR routes are transport/auth/upload/thumbnail bridges, not a second data mode. Production should use same-origin HyperBEAM where possible, while preserving these routes where browser cookie or server-held signer boundaries require them.

Thumbnail upload uses a server-held `HYPERBEAM_CACHE_WRITER_JWK` to sign generic `~cache@1.0/write`. The browser does not receive that key. The signer address must be trusted by the node's `cache_writers` configuration.

## Comments

The `Comments` facade in `ui/comments.ts` always calls native HyperBEAM helpers.
It must not call Commentron or an LBRY API directly.

- Native roots, replies, revisions, and owner controls are discovered through stock `~query@1.0/only` and hydrated by immutable ID.
- Product logic performs deduplication, revision-chain selection, hierarchy construction, counts, sorting, moderation projection, and pagination.
- Root comments and replies are generic committed messages. Edits and author
  deletes are append-only revisions; never mutate a stored comment.
- Require the local HyperBEAM account before creation. Its cookie committer,
  not its local-storage fields, owns the resulting comment.
- Accept a version only after verifying its exact commitment and deriving its
  owner from the transport committer. Claimed profile fields never grant
  authority.
- The HyperBEAM account profile is display metadata. Display its name only when
  the profile message verifies under the comment's committer, and never pass
  the native profile ID to the LBRY URI parser.
- Advanced moderation, creator reactions, delegates, and mutable settings are
  unsupported until native cookie-committer contracts exist. Do not silently
  fall back to legacy services.

## Reactions

- Video and comment reactions use generic `odysee-reaction@1.0` committed
  messages, exact query discovery, immutable hydration, and committer authority.
- A toggle or switch appends a contiguous same-owner revision. Reject forks and
  conflicting semantic duplicates and count at most one active reaction per
  verified committer and target.
- HyperBEAM cookie accounts must not be redirected into legacy authentication,
  and reaction actions must not call legacy reaction endpoints.

## Playlists

- Public playlists use generic immutable `odysee-playlist@1.0` snapshot messages.
  Do not call `collection_*`, create an application device, or publish an LBRY
  collection claim.
- Persist only ordered immutable native IDs or legacy outpoints. Draft URIs must
  resolve before publish.
- Each explicit publish creates a new message ID and share URL. Published
  snapshots cannot be updated or deleted; local edits may be published as a new
  snapshot.
- Built-in lists and unpublished drafts stay local. Mutable reference behavior
  is deferred until its canonical device contract is confirmed.

## Follows And Subscriptions

- Free follows use generic `odysee-subscription@1.0` committed messages, exact
  query discovery, immutable hydration, and committer authority.
- Follow, bell-preference changes, unfollow, and re-follow are contiguous
  same-owner append-only revisions. Stop at forks and reject conflicting
  semantic duplicates.
- Bind relationships to a stable native channel ID or full legacy channel claim
  ID. Names and mutable URIs are display/lookup data, not authority.
- Cookie accounts must not be redirected into legacy authentication, and
  subscription actions must never call the legacy subscription API.
- One-time legacy import, aggregate counts, paid memberships, and Following-feed
  aggregation are separate contracts.

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
pnpm run test:native-reactions
pnpm run test:native-playlists
pnpm run test:native-subscriptions
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Use the focused native comment, control, upload, static-manifest, and browser smoke scripts when their surfaces change.
For the cookie-owned comment lifecycle, run
`HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments`
against the configured local node.
Run `test:native-cookie-subscriptions` against the same configured node when
follow persistence or account ownership changes.

## Current State And Limitations

- The browser-side legacy wiring switch and compatibility-read toggle are retired.
- Search and query produce locators and hydrate separately; do not regress to passing backend search documents directly into Redux.
- Comments are node-native only. Root, reply, edit, and author-delete flows are
  implemented; advanced moderation and settings remain unsupported.
- Meilisearch must be running and populated for fuzzy search. It is not a source of truth.
- The normal SSR deployment remains necessary for local auth bridges and server-held cache signing.
- Recommendations and local wallet operations have separate contracts and should not be mislabeled as normal search or browser legacy mode.

Update this file whenever routing ownership, integration contracts, environment variables, validation, or known limitations change.
