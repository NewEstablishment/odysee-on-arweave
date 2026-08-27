# Odysee Frontend Component Guide

This directory contains the static Odysee React application. Its product path
is the store-first HyperBEAM node; the manifest build is the production shape.

## Routing contract

- `ODYSEE_HYPERBEAM_NODE_API` is required and baked into a manifest build.
- There is no browser-selectable Legacy/HyperBEAM mode.
- `ui/lbry.ts` remains the SDK-shaped facade used by Redux and components.
- `ui/util/hyperbeam.ts` owns node requests, response parsing, immutable
  hydration, and SDK-compatible normalization.
- Product data must not bypass HyperBEAM to call Commentron, Lbryio, the SDK
  proxy, Odysee APIs, search/recommendation services, geo, legal, or blocklist
  services.
- `ui/util/hyperbeamFetchGuard.ts` is installed before the app and blocks
  remaining legacy-host browser requests in HyperBEAM mode. Its host list must
  be built from the same production config values used by the SDK facade,
  including both SDK proxy URLs.
- Legacy-only SDK methods fail before transport in HyperBEAM mode. Sockety,
  Odysee livestream APIs/signaling/WHIP, and the short-URL service are
  unavailable until native contracts exist; they must not become silent
  browser fallbacks.

Legacy services may still source historical bytes behind backend stores. That
does not authorize a direct browser fallback.

Full-text search calls generic `search@1.0` through `ui/util/hyperbeam.ts`.
`ui/util/hyperbeamSearch.ts` maps product options to bounded generic filters,
sort, limit, and offset. Hydrate the ordered immutable locators afterward;
never implement ranking-affecting filters or pagination in a page component.
Empty-query homepage/category discovery uses this same path. Native channel
uploads use bounded exact `query@1.0` discovery because `channel-id` is not a
generic full-text index selector.

Keep `/$/discover` mounted without tag or moderator prerequisites. Existing
links use its query parameters for generic search filters; materialized named
categories use `/$/<category-name>` alongside it.

## Static manifest

`pnpm run build:manifest` is the production build contract:

- materialize ranked homepage/category `immutableIds` from the configured
  node's generic `search@1.0` result and exact-read every locator before build;
- require a populated search backend and fail rather than emit a homepage that
  depends on the absent SSR `/$/api/content/v2/get` route;
- enable `CUSTOM_HOMEPAGE=true` inside the script and verify that a materialized
  locator reached the emitted JavaScript;
- hash routing;
- relative asset paths;
- filenames and paths accepted by the node manifest handler;
- JSON-like assets stored opaquely so `/id` does not parse them as message
  fields;
- the node API embedded at build time.

The built SPA is published with `pnpm run publish:manifest` and served through
the node's generic `manifest@1.0` request hook. Production does not require the
repository's SSR server or same-origin API bridge. SSR files may remain for
development or inherited application tooling, but they are not a second
product-data architecture.

`custom/homepages/v2/index.ts` is ignored generated build input. Regenerate it
with `pnpm run materialize:manifest-homepage`; never hand-maintain search IDs in
that file. Use `HYPERBEAM_BASE_URL` to override the materializer's node.

The manifest and node should be same-origin so the `secret-*` identity cookie
is sent on native writes.

## Identity and account UI

- The node's `cookie@1.0` provider mints identity on the first committed write.
- Its private non-volatile wallet store lets the same cookie recover the same
  committer across node restarts.
- Signup asks only for a display name and commits a channel-profile message.
- The cookie signer owns later uploads, comments, reactions, playlists,
  subscriptions, and encrypted preference snapshots.
- Local storage holds only the profile ID/name and signed-in display state. It
  is not an authority source.
- Sign out hides the local profile but retains the cookie so login can restore
  it. Creating a new account clears the old identity cookie first.
- Do not reintroduce email, password, verified-email, Odysee-token, or LBRY
  channel-signature gates for native writes.

## Reads, playback, and hydration

Historical reads use store paths through generic cache/message routes. Native
reads use exact committed IDs. Mutable names and claim IDs are locators only.

- Preserve immutable IDs through Redux and navigation.
- Normalize exact native profile messages into SDK-compatible channel claims at
  this boundary. Bind friendly channel URIs to the full 43-character profile
  ID and do not spread raw HTTP or codec fields into Redux claim state.
- A bare native `lbry://<name>` resolves by querying the
  `odysee-upload@1.0` index message and hydrating its immutable record ID.
- Playback reads historical stream/media paths or a native upload's immutable
  data ID; it does not call a custom stream device.
- Mutable reads send `cache-control: no-store, no-cache`.
- Response parsing must preserve HyperBEAM header/multipart fields and exact
  commitment identity.
- Native channel, upload, and moderation flows must not call legacy
  `channel_sign`, reward-address, or livestream-status endpoints.
- In HyperBEAM mode, `channel_sign` must fail before SDK transport, and the
  legacy SDK proxy host remains blocked by the fetch guard as defense-in-depth.
  Do not make native pages sign merely to populate legacy livestream metrics.

## Uploads and thumbnails

- HyperBEAM mode posts raw bytes directly to
  `/id?0.%21=true&committers=all` with cookie credentials.
- It writes a generic `odysee-upload@1.0` record after the data write.
- The uploads page queries those records rather than `claim_list`.
- Do not run legacy TUS token, transcode, transmux, optimizer, bitrate, or file
  size gates for a raw node upload.
- Do not persist `File`, pipeline-item, or remote-upload transient state.
- Thumbnail bytes use the same generic committed-ID write path. Do not require
  a server-held cache-writer key or an SSR thumbnail bridge in this
  architecture.
- Node, loopback, private-network, relative, `data:`, and `blob:` image sources
  must bypass external thumbnail optimizers. Preserve the configured node
  scheme when rendering these URLs.
- HyperBEAM mode must not send playback telemetry to the legacy Watchman host.

## Comments

`ui/comments.ts` is native-only. It must not call Commentron or the LBRY API.

- Roots and replies are ordinary committed messages discovered through stock
  `query@1.0/only`.
- Hydrate each returned immutable ID and verify its exact commitment.
- Derive authority from the verified committer, never claimed channel/profile
  fields.
- Display a native profile name only if that profile message verifies under
  the same committer.
- Edits and author deletes are append-only revisions linked to the logical root
  and previous version.
- Store new comment text in `body`; readers may accept historical `comment` or
  `text` fields.
- Accept only a contiguous same-owner chain; a deleted comment cannot be
  edited again.
- Build hierarchy, counts, sorting, pagination, and projection in the
  integration layer, not in generic query.
- Never pass a native profile ID to the LBRY URI parser.

## Reactions

- Video and comment likes/dislikes are generic `odysee-reaction@1.0` messages
  written through `/id?0.%21=true&committers=all`.
- Discover them by target and subject through stock `query@1.0/only`, hydrate
  exact paths, and verify commitments and committers before projection.
- A like/dislike switch and removal creates a contiguous append-only revision
  using stable logical reaction/version references.
- Count at most one current state per verified committer and target, even when
  duplicate roots or physical representations exist.
- Key Redux "my reaction" state by the active native profile so identity
  changes cannot inherit another account's UI state.
- Never use claimed profile fields as authority and never call the legacy
  reaction API or a custom reaction device.

Creator hide, pin, heart, and channel block/unblock are generic append-only
comment-control messages authorized by the exact content committer. Moderation
delegates and blocked-word settings remain unsupported; fail explicitly
instead of falling back to legacy services.

## Playlists

- Public playlists are generic `odysee-playlist@1.0` messages written through
  `/id?0.%21=true&committers=all`; do not call `collection_*` or add a playlist
  device.
- Store a complete ordered immutable item list in every snapshot. Native IDs
  and legacy outpoints are allowed; mutable claim IDs, names, and URIs are not.
- The pinned external `reference@1.0` init commitment is the stable public
  playlist ID. Republish writes a new full snapshot and then a strictly newer
  same-owner reference set; it never mutates an earlier snapshot.
- Hydrate and verify every init, set, and selected snapshot. Bind authority to
  the init committer, never profile fields or query order. Reject foreign
  writers, stale or tied updates, and foreign-owned snapshots.
- Local drafts and builtin lists remain local. Public deletion is not exposed.
- Preserve Redux collection shape and playback order at the integration
  boundary. The playlist UI must not expose channel selection, URL names,
  bids, balances, confirmations, supports, reports, or abandon-claim flows.

## Subscriptions

- Free follows use generic `odysee-subscription@1.0` messages written through
  `/id?0.%21=true&committers=all`; do not call the legacy `subscription` API,
  wallet sync, or add a subscription device.
- Build a deterministic owner/channel `subscription-ref` from the verified
  committer and a stable native profile ID or full legacy channel claim ID.
- Follow, bell-preference update, unfollow, and re-follow append contiguous
  revisions. Hydrate exact IDs and reject gaps, forks, conflicting versions,
  and foreign committers.
- A new follow defaults notifications off unless the user explicitly enables
  the bell; omitted preferences must behave the same from every UI entry point.
- Redux and persisted subscription arrays are optimistic caches only. Replace
  them with the verified node projection on account load/change.
- A future one-time legacy import may create missing roots with explicit
  provenance. It must not become a fallback or recurring synchronization path.
- Paid creator memberships are not free follows and are outside this contract.

## User preferences

- `Lbry.preference_get` and `Lbry.preference_set` stay SDK-shaped, but a
  configured HyperBEAM node routes them through `ui/util/hyperbeam.ts`. Do not
  fall back to the legacy daemon after a native request fails.
- Persist an immutable encrypted `odysee-preferences@1.0` snapshot through the
  generic stage-scoped ID write, then move its generic `reference@1.0` head
  with a strictly newer same-owner set message.
- Discover only reference locators through `query@1.0`; hydrate and verify the
  exact init, set, and snapshot messages. Reference discovery includes the
  authenticated owner as an indexed selector, and every hydrated reference
  must bind that claimed owner to its verified committer. Authority comes from
  commitment committers, never local profile metadata or query order. Fail
  closed on foreign writers, foreign-owned snapshots, stale updates, and
  conflicting timestamp ties.
- `odysee-preference@1.0` only derives the authenticated owner and seals/opens
  AES-GCM envelopes. Its responses are private/no-store; plaintext, cookies,
  and wallet keys must never appear in public messages or browser storage.
- The native shared blob includes settings, tags, welcome state, analytics
  sharing choice, and announcement state. Exclude subscriptions/follows,
  blocked/moderation state, coin-swap state, and private/local collections so
  their authoritative domains cannot be overwritten during hydration.
- The manifest calls the node directly with cookie credentials. The
  same-origin SSR auth/write bridges are development transport boundaries, not
  a second preference architecture.
- During startup, restore a native user only after the cookie owner and exact
  profile committer match, then hydrate shared preferences. Native Retry repeats
  this preference read and never starts the legacy sync loop.
- Exact snapshot/reference readback acknowledges a preference save. Do not make
  a successful write depend on the query listener indexing it synchronously.
  Retain the newest exact-verified state per authenticated owner so a queued
  save during index lag advances the same reference rather than forking a
  second init or restoring a stale snapshot.

## Analytics

- `analytics@1.0` is a generic observational device. Odysee playback maps to
  its engagement lifecycle through `ui/analytics/hyperbeam.ts` and
  `ui/analytics/watchman.ts`.
- Browser playback and view-count code must not call the legacy Watchman or
  view-count APIs. Public counts are aggregates; reports and historical
  baseline imports require wallet authentication.
- Analytics are non-authoritative signals and must never affect content
  identity, verification, discovery order, or access.

## Publish and route guards

- A configured HyperBEAM node enables native upload routes even without a
  legacy verified-email account.
- The upload route, header actions, form validation, and publish payload must
  all use the same `hyperbeamUploadEnabled()` decision.
- The publish URL shows the node origin in HyperBEAM mode.
- The no-user/account nag must not block the manifest-native account flow.

## Validation

Run after changing the frontend integration:

```sh
pnpm run typecheck:tsc
pnpm run check
pnpm run test:native-comment-revisions
pnpm run test:native-message-verification
pnpm run test:native-comment-controls
pnpm run test:native-reactions
pnpm run test:native-playlists
pnpm run test:native-subscriptions
pnpm run test:native-preferences
pnpm run test:manifest-homepage
pnpm run test:static-manifest
pnpm run build:manifest
```

Against a running cookie-auth node:

```sh
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-reactions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-playlists
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-subscriptions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-preferences
```

Also verify the actual browser lifecycle: manifest loads, signup mints the
cookie, raw upload resolves and plays, comments, playlists, and subscriptions render after
reload, and no
normal-flow request reaches a legacy host.

## Current limitations

- View totals combine an owner-imported historical baseline with qualified
  generic `analytics@1.0` engagement. The device does not serve a dashboard;
  the upstream dashboard is an independently hosted frontend. An Odysee-owned
  dashboard is not yet implemented.
- Native subscriber counts, moderation delegates, and blocked-word settings
  are not implemented.
- Upload edit/delete needs a complete append-only native contract.
- Only single HTTP byte ranges are supported; multipart range responses are not.
- The cookie identity is node/browser-local and is not yet portable or
  recoverable. Preference recovery consequently remains local to the same hosted
  wallet until a portable identity or secret-sync contract exists.

Update this guide whenever the manifest, account, upload, comment, playback,
analytics, or browser-routing contract changes.
