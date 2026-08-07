# Odysee on HyperBEAM Agent Guide

This file defines the monorepo-wide engineering rules for Odysee on HyperBEAM.
It is an operating guide, not a historical plan. Keep it aligned with the
current implementation.

## Start Here

Before changing code:

1. Read the root `README.md` for the complete architecture and feature flows.
2. Read `hyperbeam/AGENTS.md` before changing the runtime, devices, codecs,
   stores, or verification libraries.
3. Read `odysee-frontend/AGENTS.md` before changing browser, Redux, SSR,
   playback, upload, auth, search, comments, or diagnostics behavior.
4. Inspect `git status` and the relevant code before forming a solution. The
   worktree may contain user changes; preserve and work with them.
5. Identify the owning boundary before editing. Do not patch a page to hide a
   device, store, identity, or normalization defect.

User instructions are the immediate source of truth. The current code,
component guides, tests, and root README describe the implemented contracts.
Local meeting notes and investigation memory may provide context, but stale
plans and old branch snapshots do not override the current architecture.

## Repository Map

| Path | Ownership |
| --- | --- |
| `README.md` | Full system orientation, device catalogue, feature flows, configuration, operation, and limitations. |
| `AGENTS.md` | Monorepo-wide operating rules and architecture invariants. |
| `hyperbeam/` | HyperBEAM runtime, generic devices, Odysee product devices, LBRY codecs, stores, and verification libraries. |
| `hyperbeam/AGENTS.md` | Detailed backend contracts, device ownership, operations, and validation. |
| `odysee-frontend/` | React/Redux application, SDK-shaped integration facade, SSR server, bridges, playback, uploads, and diagnostics. |
| `odysee-frontend/AGENTS.md` | Detailed browser/SSR routing, hydration, comments, search, and validation contracts. |
| `scripts/` | Cross-component operational tooling. It currently contains the Chainquery-to-Meilisearch importer and its tests. |
| `aidocs/` | Shared architecture docs, decision records, run instructions, and specs. |

External source references are separate sibling repositories. The local
Meilisearch checkout is at `../meilisearch`, with its normal locally built binary
at `../meilisearch/target/release/meilisearch`. The Lighthouse checkout is at
`../lighthouse` and is used only to compare legacy search schema, filters, and
ranking. Do not add source snapshots or gitlinks for either repository to this
monorepo.

## System Contract

The application has one product data route:

```text
Browser / SSR
    -> frontend SDK-shaped integration
    -> HyperBEAM devices and direct immutable reads
    -> local/cache/remote/source stores
    -> compatibility services only behind those boundaries
```

Odysee API, the LBRY SDK proxy, Commentron, Chainquery, blobcache/player
services, and Meilisearch remain useful compatibility or discovery sources.
They are not an alternate browser mode. Do not restore browser-selectable
Legacy/HyperBEAM routing, direct browser product calls to legacy services, or
the removed catch-all `odysee@1.0` SDK proxy.

Local wallet or daemon-only operations may retain their local SDK contract
until a real HyperBEAM contract exists. That narrow exception is not a network
legacy mode and must not bypass an existing device contract.

## Architectural Invariants

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
11. **Compatibility sourcing remains observable.** Weaker player-proxy or
    legacy-source boundaries must be represented honestly in response metadata
    and diagnostics.
12. **Observed diagnostics report reality.** Debug graph activity, call counts,
    edges, backends, and stores must come from actual request events. Never add
    fictitious nodes, inferred calls, or hardcoded active paths.

## Change Ownership

Use this ownership table before implementing a fix:

| Concern | Correct location |
| --- | --- |
| Reusable exact matching or generic full-text behavior | Upstream-style HyperBEAM device under `hyperbeam/src/preloaded/query/` |
| Odysee account, claim, channel, comment, playback, upload, policy, reference, or claim-search behavior | Narrow Odysee device under `hyperbeam/src/preloaded/odysee/` or `hyperbeam/src/preloaded/auth/` |
| LBRY binary format or cryptographic verification | LBRY codec under `hyperbeam/src/preloaded/codec/` plus supporting module under `hyperbeam/src/core/lib/` |
| Legacy or remote source lookup | HyperBEAM store module |
| SDK call routing, request construction, hydration, normalization, source merging, or Redux-compatible shape | `odysee-frontend/ui/lbry.ts`, `ui/util/hyperbeam.ts`, and related integration services |
| Cookie or server-held key boundary | SSR routes and server-side HyperBEAM adapter |
| Rendering and interaction only | React components |
| Historical Odysee search import and index rebuild | Root `scripts/import-chainquery-meili.mjs` |

Search for existing helpers before creating new abstractions. On the backend,
check `hb_ao`, `hb_util`, `hb_maps`, and existing Odysee/LBRY modules. On the
frontend, preserve the established facade and normalization paths instead of
adding another transport path.

## Identity Rules

Use the correct identity for every operation:

| Object | Identity |
| --- | --- |
| Native HyperBEAM message | Immutable HyperBEAM message ID derived from its commitment |
| Legacy claim output | Immutable `<txid>:<nout>` outpoint |
| Legacy transaction | Display-order 64-character transaction ID |
| Legacy blob | 96-character SHA-384 blob hash |
| Stream descriptor | SHA-384 `sd_hash` |
| Legacy claim | 40-character mutable/reference-like claim ID |
| Name or URI | Mutable lookup input, never an immutable store key |
| Search document | Immutable `doc_id` / `search_id` locator |
| Native comment revision | Physical immutable message ID linked to a logical root comment ID |

A claim ID may identify the evolving logical claim, but it does not identify one
immutable claim-output version. A legacy immutable claim-output path is
`odysee/claim-output/<txid>/<nout>`. Native message IDs and immutable outpoints
must survive search, list merging, Redux hydration, playback, and cache reads
without being replaced by mutable compatibility keys.

## Core Feature Boundaries

### Claims and channels

- Mutable URI and claim-ID resolution uses `odysee-claim@1.0`.
- Immutable native IDs and outpoints use direct store reads.
- `hb_store_odysee` and dedicated LBRY stores may source historical data on
  demand, normalize it, verify available evidence, and let ordinary cache/store
  behavior retain the resulting immutable representation.
- Channel and upload views merge native and historical entries, deduplicate by
  stable identity, and sort the combined result. Never prepend one source as an
  unsorted block.

### Playback

- `odysee-stream@1.0` owns playback and ranged media behavior.
- Prefer the verifiable transaction -> claim output -> descriptor -> blob path.
- Preserve HTTP range semantics for seeking and browser playback.
- Player-proxy fallback belongs inside the stream device and must remain labeled
  as a weaker compatibility source.

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
- `odysee-subscription@1.0` is an internal compatibility implementation. The
  public/frontend subscription-count surface is `odysee-account@1.0`.

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
cd hyperbeam
HOME=/tmp/odysee-hb-home rebar3 as hyperbeam compile
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_claim
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_comment
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_stream
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_upload
```

Run only the relevant focused device tests when the whole set is unnecessary,
but include the matching LBRY codec/store EUnit coverage when source evidence or
identity changes.

Frontend baseline:

```sh
cd odysee-frontend
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Focused integration checks include:

```sh
pnpm run test:hyperbeam-upload-smoke
pnpm run test:hyperbeam-query-comment-smoke
pnpm run test:native-comment-revisions
pnpm run test:native-comment-controls
pnpm run test:static-manifest
```

Importer validation runs from the repository root:

```sh
node --test scripts/import-chainquery-meili.test.mjs
```

For user-facing flows, verify the actual browser behavior and inspect the real
request/device/store path. A passing unit test does not prove correct hydration,
Redux state, media ranges, auth cookies, source merging, ranking, or rendering.
Do not present work as complete while the relevant service is down or the target
workflow has not been exercised.

Always run `git diff --check` before finishing. Report tests that were not run and
the remaining risk plainly.

## Documentation Rules

- Keep the root `README.md` complete enough to onboard a new human or agent.
- Keep each component `AGENTS.md` concise and authoritative for that component.
- Update the relevant guide in the same change when architecture, ownership,
  public operations, identity, configuration, run commands, validation, or known
  limitations change.
- Store shareable plans, specs, and decision records under `aidocs/`.
- Plans should describe decisions, constraints, acceptance criteria, and
  verification in detail while minimizing copied implementation code.
- Record durable current decisions, not completed migration checklists or stale
  branch histories.
- Do not add generated documentation, secrets, database dumps, build output, or
  dependency trees to version control.

## Engineering and Git Hygiene

- Do not add code comments unless they are necessary to explain behavior that
  the code cannot make clear itself.
- Prefer existing patterns and helpers. Keep changes within the owning boundary
  and avoid unrelated refactors.
- Use structured parsers and APIs for structured data.
- Preserve user changes in a dirty worktree. Never reset, overwrite, or revert
  changes you did not make unless the user explicitly requests it.
- Do not run destructive Git commands without explicit instruction.
- Do not create commits unless the user explicitly asks for a commit.
- Keep sibling reference checkouts read-only. Never implement this project's
  production behavior in them.
- Remove obsolete temporary files and failed experimental artifacts before
  finishing, while leaving unrelated user files untouched.
- Continue through implementation, verification, cleanup, and documentation.
  Do not stop at a plan or intermediate state unless the user pauses the work or
  a real external blocker prevents further progress.
