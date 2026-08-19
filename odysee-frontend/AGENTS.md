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
  remaining legacy-host browser requests in HyperBEAM mode.

Legacy services may still source historical bytes behind backend stores. That
does not authorize a direct browser fallback.

## Static manifest

`pnpm run build:manifest` is the production build contract:

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

The manifest and node should be same-origin so the `secret-*` identity cookie
is sent on native writes.

## Identity and account UI

- The node's `cookie@1.0` provider mints identity on the first committed write.
- Signup asks only for a display name and commits a channel-profile message.
- The cookie signer owns later uploads, comments, reactions, playlists, and subscriptions.
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
- A bare native `lbry://<name>` resolves by querying the
  `odysee-upload@1.0` index message and hydrating its immutable record ID.
- Playback reads historical stream/media paths or a native upload's immutable
  data ID; it does not call a custom stream device.
- Mutable reads send `cache-control: no-store, no-cache`.
- Response parsing must preserve HyperBEAM header/multipart fields and exact
  commitment identity.

## Uploads and thumbnails

- HyperBEAM mode posts raw bytes directly to
  `/id?!=true&committers=all` with cookie credentials.
- It writes a generic `odysee-upload@1.0` record after the data write.
- The uploads page queries those records rather than `claim_list`.
- Do not run legacy TUS token, transcode, transmux, optimizer, bitrate, or file
  size gates for a raw node upload.
- Do not persist `File`, pipeline-item, or remote-upload transient state.
- Thumbnail bytes use the same generic committed-ID write path. Do not require
  a server-held cache-writer key or an SSR thumbnail bridge in this
  architecture.

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
- Accept only a contiguous same-owner chain; a deleted comment cannot be
  edited again.
- Build hierarchy, counts, sorting, pagination, and projection in the
  integration layer, not in generic query.
- Never pass a native profile ID to the LBRY URI parser.

## Reactions

- Video and comment likes/dislikes are generic `odysee-reaction@1.0` messages
  written through `/id?!=true&committers=all`.
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

Advanced moderation, delegates, and settings remain unsupported. Fail
explicitly instead of falling back to legacy services.

## Playlists

- Public playlists are generic `odysee-playlist@1.0` messages written through
  `/id?!=true&committers=all`; do not call `collection_*` or add a playlist
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
  `/id?!=true&committers=all`; do not call the legacy `subscription` API,
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
pnpm run test:static-manifest
pnpm run build:manifest
```

Against a running cookie-auth node:

```sh
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-reactions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-playlists
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-subscriptions
```

Also verify the actual browser lifecycle: manifest loads, signup mints the
cookie, raw upload resolves and plays, comments, playlists, and subscriptions render after
reload, and no
normal-flow request reaches a legacy host.

## Current limitations

- Native view/subscriber counts and advanced moderation are not implemented.
- Upload edit/delete needs a complete append-only native contract.
- Generic cache range propagation limits seeking for some historical media.
- The cookie identity is node/browser-local and is not yet portable or
  recoverable.

Update this guide whenever the manifest, account, upload, comment, playback,
or browser-routing contract changes.
