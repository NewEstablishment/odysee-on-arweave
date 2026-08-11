# Odysee Frontend Component Guide

This directory is the repository's only product frontend. It owns the
React/Redux browser application, SSR server, static-manifest build, same-origin
security bridges, and the shared HyperBEAM integration layer. Do not create a
parallel `frontend/` directory or treat stale compatibility routes as a second
runtime mode.

## Routing contract

- `ODYSEE_HYPERBEAM_NODE_API` selects the HyperBEAM node.
- There is one product data path. Do not add a Legacy/HyperBEAM selector,
  browser storage flag, query parameter, or direct React fallback to Odysee
  network services.
- `ui/lbry.ts` is the SDK-shaped facade used by existing actions.
- `ui/util/hyperbeam.ts` owns generic read/query construction, locator
  hydration, normalization, list merging, and native revision projection.
- Local wallet/daemon-only operations may retain their existing local contract
  until a real HyperBEAM contract replaces them. That is not a network legacy
  mode.

Historical services may still supply bytes or locators behind the node's
stores. Compatibility sourcing does not belong in components or Redux actions.

## Identity and hydration

Query and search results are locators, not claim objects. Hydrate them through
normal HyperBEAM reads, normalize at the integration boundary, and preserve
discovery order.

- Native content uses immutable HyperBEAM message IDs.
- Legacy immutable claim outputs use `<txid>:<nout>`.
- Legacy claim IDs and Odysee URIs are mutable locators.
- Media for a native upload uses its immutable `data-id`, never the metadata
  record ID.
- Root and version IDs for native uploads must survive synthesis into SDK claim
  shape; do not replace them with the media ID.
- Merged native/historical lists deduplicate by stable identity and sort the
  combined result instead of prepending one source.

Every native product locator must be hydrated through
`fetchVerifiedNativeMessage`. A valid result requires the exact immutable
message, `/<id>/verify?commitment-ids=<id>` returning true, and the committer at
`/<id>/commitments/<id>/committer`. Do not use `commitment-ids=all`; it can be
vacuously true for an uncommitted message. Discard query paths and write
read-backs that do not pass the exact check.

## Authentication and SSR bridges

The Odysee `auth_token` cookie cannot be sent from the browser to a node on a
different origin. Same-origin SSR routes may read that HttpOnly cookie and
forward only the required token to HyperBEAM. Explicit browser tokens use
`x-odysee-auth-token`.

`writeNativeMessage` must attach `authTokenHeader()` for direct generic writes.
The upload service uses `/$/api/hyperbeam-upload/v1/write`; the bridge sends the
bytes and auth carrier to `/id?!=true&committers=all`. It is a transport and
security boundary, not an upload device or second data mode.

Never place cookies, auth tokens, derived secrets, or private keys in public
message fields, URLs, debug events, persistence, or Redux state. Logged-out
writes are expected to receive `401`; do not invent an anonymous identity in
local storage.

Thumbnail writes that require `HYPERBEAM_CACHE_WRITER_JWK` remain server-side.
The browser must never receive that signer.

## Native uploads

`ui/services/hyperbeamUpload.ts` writes two ordinary messages for a new upload:
immutable media bytes and a signed metadata root with
`schema: odysee-upload@1.0`, `type: upload`, and `data-id` pointing to the media.

Updates and deletes are append-only snapshots. Projection is centralized in
`ui/util/nativeUploadRevisions.ts`:

- only the root owner can extend the chain;
- `revision-of` remains the root and `previous-version` equals the current
  signed `version-ref`;
- revisions increase by one;
- media ID, name, and creation timestamp remain immutable;
- update keeps the record active and delete creates a terminal tombstone;
- forks, gaps, owner spoofing, invalid operations, and post-delete revisions
  are ignored.

Use signed `version-ref` for logical continuity. A message served through a
query locator can acquire a different physical RSA-PSS commitment ID, so the
physical locator is not a stable previous-version key.

The current UI mutation code must not call `~odysee-upload@1.0`. Some old SSR,
debug, and routing constants still mention that removed device; they are
dormant cleanup debt and not authorization to restore it.

## Comments and search

Native comments are ordinary signed messages discovered with generic
`~query@1.0/only` and hydrated by immutable locator. Revision selection,
hierarchy, counts, sorting, and moderation projection belong in the integration
layer. Do not mutate an existing comment.

Comments use a signed `comment-ref` as their logical ID and signed
`version-ref` values for contiguous revisions. Controls use a signed
`control-ref`. Keep the physical locator separately for exact verification.
Comment revisions must retain the root committer. Author controls must be
committed by the comment root's committer; owner controls must be committed by
the target native upload's committer. A claimed channel ID or structurally
present channel signature is not transport authority.

Playlists follow the same exact-verification and same-committer revision rules.
Their revisions must be contiguous through signed `version-ref` values.
Transport verification does not cryptographically prove LBRY channel
signatures. Native channel writes and an account-to-channel proof are not
implemented yet, so legacy-target owner controls must fail closed.

`~query@1.0` is exact local discovery. `~search@1.0` is generic full-text
search. Both return locators; neither should return product-hydrated Redux
objects. An unpatched query device may fail on an empty result, so callers may
normalize that known failure to an empty list without fabricating results.

## Debug console

Debug state must describe observed calls only. Known nodes may be drawn as
inactive, but call counts, edges, stores, backends, and active device paths must
come from real request events. Removed product-device labels must not be shown
as active for generic store/message traffic.

## Static manifest and local operation

`pnpm run build:manifest` builds relative assets and hash routing suitable for
publishing through HyperBEAM. Normal SSR builds use the web server and browser
routing.

```sh
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18800 pnpm run dev:web-server
```

The SSR server normally listens on `9090`. Run only one `dev:web-server`
supervisor.

## Validation

For integration changes run:

```sh
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Use the focused scripts for affected behavior:

```sh
pnpm run test:native-message-verification
pnpm run test:native-upload-revisions
pnpm run test:hyperbeam-upload-smoke
pnpm run test:hyperbeam-query-comment-smoke
pnpm run test:native-comment-revisions
pnpm run test:native-comment-controls
pnpm run test:native-playlist-revisions
pnpm run test:hyperbeam-playlist-smoke
pnpm run test:static-manifest
```

The upload, comment, and playlist smokes need a running write-capable node and
SSR frontend. They must cover exact commitment verification, committer
ownership, rejection of uncommitted query artifacts and hostile revisions,
discovery/projection, and byte-exact upload read-back—not only a successful
HTTP status.

Update this guide whenever the single data route, identity, auth forwarding,
revision contract, local operation, validation, or known limitations change.
