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

## Change ownership

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

## Validation

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
