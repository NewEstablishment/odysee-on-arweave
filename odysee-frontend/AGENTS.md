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
- The cookie signer owns later uploads and comments.
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
pnpm run test:static-manifest
pnpm run build:manifest
```

Against a running cookie-auth node:

```sh
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
```

Also verify the actual browser lifecycle: manifest loads, signup mints the
cookie, raw upload resolves and plays, comments render after reload, and no
normal-flow request reaches a legacy host.

## Current limitations

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
