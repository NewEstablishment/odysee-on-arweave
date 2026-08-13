# Odysee on HyperBEAM

This repository runs Odysee content through HyperBEAM with a store-first
architecture. Historical LBRY/Odysee infrastructure is a source of bytes and
locators; the node verifies source evidence, commits the result, and caches the
immutable message before serving it.

There is one product frontend: `odysee-frontend/`. Do not create or maintain a
second `frontend/` tree. The old proof-of-concept frontend was removed; the
tracked Odysee application is the canonical browser, SSR, manifest, and upload
integration.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/odysee/src/` | Odysee Erlang application: LBRY commitment code, auth/search helpers, node options, source clients, and stores. |
| `odysee-frontend/` | The only frontend: React/Redux UI, SDK-shaped integration, SSR bridges, static-manifest build, and frontend tests. |
| `aidocs/` | Architecture notes and runnable demonstrations for this branch. |
| `patches/` | Small proposed fixes for the pinned upstream HyperBEAM dependency. |
| `rebar.config` | Pins HyperBEAM and builds this project as a standalone Erlang application. |

HyperBEAM is a pinned dependency under `_build`; it is not a tracked
`hyperbeam/` subdirectory in this repository. Generated `_build`, cache, and
frontend dependency/output trees are not source directories.

## Architecture

```text
Browser or SSR
    -> odysee-frontend integration facade
    -> generic HyperBEAM reads, writes, query, cache, and search
    -> local/cache/source store stack
    -> historical Odysee/LBRY services only on a verified cache miss
```

The design deliberately avoids a broad Odysee application-device layer.
Product records such as native uploads, channels, and comments are ordinary
signed HyperBEAM messages. Discovery returns locators, and the frontend reads
and projects the immutable messages separately.

The active project devices are narrow:

| Device | Responsibility |
| --- | --- |
| `lbry@1.0` | Commit and verify LBRY transactions, claim outputs, stream descriptors, blobs, channels, and related ancestry evidence. |
| `odysee-auth@1.0` | Resolve an Odysee session to an account-derived hosted signing identity. |
| `reply-id@1.0` | Return the stored immutable message ID after a committed write. |
| `search@1.0` | Generic SQLite FTS5 search over HyperBEAM messages. |

The source layer consists of `hb_store_odysee` and four dedicated LBRY stores
for transactions, claim outputs, stream descriptors, and blobs. Local
`cache-http` storage is first, so verified and native messages are served and
queried locally before any compatibility source is consulted.

## Identity and trust

- A native message is named by its immutable HyperBEAM commitment ID.
- A legacy claim output is named by immutable `<txid>:<nout>` evidence.
- A 40-character claim ID or an Odysee URI is a mutable locator, not an
  immutable object key.
- A legacy transaction uses its display-order 64-character transaction ID.
- A legacy blob or stream descriptor uses its SHA-384 hash.
- Search and `query@1.0` return locators; callers hydrate the corresponding
  messages and preserve result order.

On a cold historical read, `hb_store_odysee` classifies the locator and obtains
the required source objects. Dedicated stores verify hashes and ancestry and
emit messages carrying `lbry@1.0` commitments. Invalid evidence fails closed.
Warm reads come from the local store stack.

Aliases are locators rather than proofs. A canonical immutable ID or the full
cache read path carries the message commitment; a convenient alias can resolve
to the bytes without itself being cryptographically related to them.

## Native writes and authentication

Native content is committed through the generic endpoint:

```text
POST /id?!=true&committers=all
x-odysee-auth-token: <session token>
```

`hb_odysee_node:upload_opts/1` installs the request hook, persistent store, and
match index needed for writes. The hook runs only for a commit-flag or explicit
token-bearing request. Anonymous reads remain anonymous; protected writes
without a valid token return `401`.

Production nodes must configure one account source:

- `odysee-session-accounts`: a node-owned `token => account-id` map, useful for
  controlled/offline environments; or
- `odysee-account-api`: the Odysee internal API base used to resolve the token
  through `user/me`.

The development-only `odysee-auth-allow-unvalidated-tokens` option derives an
identity directly from an arbitrary token. It is off by default and must not be
enabled in production. PBKDF2 algorithm, salt, iterations, and key length are
node options; requests cannot choose them. Tokens and derived secrets are
request-only and are removed before signing, serialization, indexing, or
persistence.

Because Odysee can mint multiple sessions for one account, production identity
is derived from the resolved account ID rather than the individual session
token. That keeps ownership stable across logins.

## Native-message verification

All native product hydration uses one fail-closed verifier in
`odysee-frontend/ui/util/nativeMessageVerification.ts`. For an immutable
locator `<id>`, it loads that message, requires
`/<id>/verify?commitment-ids=<id>` to return true, and reads the committer from
`/<id>/commitments/<id>/committer`. Product code receives the payload only when
all three checks succeed. It must request the exact ID rather than
`commitment-ids=all`, which can succeed vacuously for an uncommitted message.

Uploads, comments, comment controls, and playlists use this verifier for every
root or revision they hydrate, including query results and write read-back.
Uncommitted or unverifiable query artifacts are ignored. Upload, comment, and
playlist revision projection accepts only a contiguous chain from the same
verified committer. Comment controls also require transport authority: author
controls must have the comment root's committer, while owner controls must have
the target native upload's committer.

Signed application references keep logical chains stable when a query path has
a different physical commitment locator: comments use `comment-ref`, revisions
use `version-ref`, and controls use `control-ref`. The physical message ID is
still retained for exact immutable reads and verification.

Transport commitment verification does not prove a claimed LBRY channel
identity. Channel signatures remain a separate proof and are currently only
checked for structural completeness by the frontend. Native channel writes and
a verified account-to-channel binding do not exist on this branch yet, so
owner controls for legacy targets fail closed instead of trusting a claimed
channel ID.

## Upload records

The frontend uses the same-origin
`/$/api/hyperbeam-upload/v1/write` bridge when browser cookies cannot cross to
the node. The bridge forwards only the auth carrier and bytes to the generic
commit endpoint; it is a security/transport boundary, not a second data mode.

An upload consists of:

1. an immutable media message containing the bytes; and
2. an immutable root record with `schema: odysee-upload@1.0`, `type: upload`,
   metadata, owner commitment, and the media `data-id`.

Updates and deletes append signed snapshots. A valid next version must keep the
same owner, root, media ID, name, and creation timestamp; increment `revision`
by exactly one; and point `previous-version` at the current signed
`version-ref`. Deletes are terminal tombstones. The frontend ignores forks,
owner spoofing, gaps, mutation of immutable fields, and revisions after a
tombstone.

`version-ref` is an application-level signed chain key. The physical message
ID remains the immutable locator, but an RSA-PSS message returned through a
query path can have a different commitment ID after re-signing; revision
continuity therefore must not depend on that transport-specific ID.

## Frontend integration

`odysee-frontend/ui/lbry.ts` is the SDK-shaped facade used by existing Redux
actions. `ui/util/hyperbeam.ts` constructs reads and discovery calls, hydrates
locators, normalizes claim-shaped data, and projects native revision chains.
React components should render the normalized result rather than introducing
another transport path.

The frontend still contains some dormant compatibility helpers and route names
from the removed application-device design. They are not an alternate
frontend, and new work must not route product data through them. The current
upload mutation path uses only the generic write bridge.

The public homepage is materialized hourly into one signed immutable
`odysee-homepage@1.0` message per language. Runtime discovery uses generic
`query@1.0`, exact immutable reads, commitment verification, and committer
checks. Homepage rows are hydrated in display order through the generic Lua
multirequest application. Each language snapshot preserves an ordered,
pre-warmed category pool: the homepage consumes the configured row prefix and
the matching category page consumes the larger pool, so category first paint
does not repeat discovery. Following remains a dynamic per-user query through
the same source store and ordered hydration boundary.
The previous signed snapshot remains available while a replacement is built.
Materialization imports known legacy outpoints first and accepts only verified
messages committed to the local HyperBEAM store; failed imports never become
remote immutable-ID probes. If the normal reserve cannot fill a row, only that
category's candidate pages and freshness window are expanded in bounded
rounds. The final round appends a semantic category-tag query after an
exhausted curated channel pool. An incomplete refresh is rejected and the
previous signed snapshot remains live.

## Build and run

Prerequisites: Erlang/OTP 27 or newer, `rebar3`, Node.js 22.12 or newer, and
`pnpm` 10.33.0.

Build the frontend manifest and local preloaded-device store:

```sh
cd odysee-frontend
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18800 pnpm run build:manifest

cd ..
HB_PORT=18734 rebar3 device local --device-src apps/odysee/src
```

The explicit source directory is required because some Forge/rebar working
directories do not infer umbrella application sources. Confirm the output lists
`lbry@1.0`, `odysee-auth@1.0`, `reply-id@1.0`, and `search@1.0` before using the
store. For normal browser development, start a write-capable node with
`hb_odysee_node:start_upload/1`; it publishes the generic Lua multirequest
application before accepting traffic. Then run the one SSR frontend:

```sh
cd odysee-frontend
ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18800 pnpm run dev:web-server
```

The SSR server normally listens on `http://localhost:9090`. Do not run two
`dev:web-server` supervisors: duplicate watchers can race or terminate the SSR
child. See `aidocs/RUN_DEMO.md` for a complete node command and manifest demo.

## Validation

Backend baseline:

```sh
rebar3 device test --with-core
```

`--with-core` is required for the store and HTTP integration coverage. Run
`rebar3 device local --device-src apps/odysee/src` after device changes when
manually testing; `rebar3 compile` alone does not republish the preloaded device
store.

Frontend baseline:

```sh
cd odysee-frontend
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Focused native tests:

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

The upload, comment, and playlist smokes require a running write-capable
HyperBEAM node and SSR frontend. They exercise exact commitment verification,
committer-based ownership, rejection of uncommitted query artifacts and
hostile revisions, revision projection, moderation controls, and byte-exact
media read-back.

## Current limitations

- An unpatched upstream `query@1.0` can fail noisily when a query has no
  results. `patches/dev-query-match-error-tuple.patch` contains the small
  upstream fix; frontend discovery currently treats this failure as an empty
  result where possible.
- HTTP range propagation through the current cache path is incomplete, so
  whole-object playback works more reliably than seeking.
- Reactions, view/subscriber counts, and the complete historical moderation
  surface are not rebuilt in the store-first path.
- Production deployment still needs a real account-resolution source and
  equivalent same-origin auth behavior.
- Native channel messages and a verified account-to-channel binding are not
  implemented yet. Channel-bearing comment signatures are not cryptographically
  verified in the production frontend, and owner moderation for legacy targets
  therefore fails closed.
- Some frontend compatibility routes still mention removed product devices;
  they are cleanup debt, not supported architecture.

For the detailed immutable read sequence, see
`aidocs/ARCHITECTURE_READ_PATH.md`. For the concise live demonstration, see
`aidocs/RUN_DEMO.md`.
