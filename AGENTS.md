# Odysee on HyperBEAM Agent Guide

This file defines the current monorepo-wide engineering rules. Keep it aligned
with the implementation; do not use old branch plans as architecture.

## Start here

Before changing code:

1. Read the root `README.md`.
2. Read `odysee-frontend/AGENTS.md` for browser, Redux, SSR, auth bridge,
   upload, playback, search, comments, or diagnostics changes.
3. Inspect `git status` and the relevant code. The worktree may contain user
   changes or an active merge; preserve both staged and unstaged intent.
4. Identify the owning boundary before editing. Do not patch rendering to hide
   a store, identity, verification, or normalization defect.

## Repository map

| Path | Ownership |
| --- | --- |
| `README.md` | Current system orientation, contracts, operation, validation, and limitations. |
| `apps/odysee/src/` | Standalone Erlang app: devices, LBRY verification, source clients, node options, and stores. |
| `odysee-frontend/` | The one React/Redux frontend, SSR server, integration facade, bridges, manifest builder, and frontend tests. |
| `odysee-frontend/AGENTS.md` | Frontend-specific contracts and validation. |
| `aidocs/` | Detailed architecture notes and demonstrations. |
| `patches/` | Small proposals for the pinned upstream HyperBEAM dependency. |

There is no tracked `hyperbeam/` source tree and no second `frontend/` tree.
HyperBEAM is pinned in `rebar.config` and materialized under `_build`. Do not
copy dependency source into the repository or recreate a proof-of-concept UI.

## System contract

```text
Browser / SSR
    -> frontend SDK-shaped integration
    -> generic HyperBEAM message, cache, query, and search surfaces
    -> local/cache/source stores
    -> compatibility sources only behind those stores
```

Legacy Odysee services are source systems, not an alternate browser mode. Do
not add a Legacy/HyperBEAM toggle, direct product fetches from React, or a broad
Odysee SDK proxy device.

## Architectural invariants

1. **Immutable reads are ID-first.** An immutable ID returns that exact object,
   never an unrelated current claim version.
2. **Discovery returns locators.** Query/search returns paths or IDs. Hydrate
   separately and preserve the discovered order.
3. **Generic devices stay generic.** Do not add Odysee ranking, hydration,
   moderation, or revision semantics to upstream `message@1.0`, `cache@1.0`,
   `query@1.0`, or the generic `search@1.0` surface.
4. **Stores source objects; integration implements product behavior.** Stores
   locate, normalize, verify, and cache source objects. The frontend integration
   projects uploads/comments and produces Redux-compatible shape.
5. **Source evidence remains separate from UI semantics.** LBRY transactions,
   claims, descriptors, blobs, ancestry, and commitments belong under
   `apps/odysee/src/`, not in React.
6. **Credentials are request-only.** Tokens, cookies, secrets, private keys,
   and derivation controls must not enter signed or persisted public messages.
7. **Indexes are not sources of truth.** Query/search discovers objects; signed
   native messages and verified LBRY evidence remain authoritative.
8. **Native state is append-only.** Updates, deletes, comment edits, and
   controls create immutable signed revisions rather than mutating history.
9. **Observed diagnostics report reality.** Do not invent device calls, stores,
   backends, or graph edges.

## Change ownership

| Concern | Correct location |
| --- | --- |
| Odysee/LBRY source lookup and normalization | `hb_store_odysee.erl` or a dedicated `hb_store_lbry_*` module |
| LBRY binary format, hash, ancestry, or commitment verification | `dev_lbry*` and related helpers under `apps/odysee/src/` |
| Request hooks, hosted identity, node store stack, and boot options | `dev_odysee_auth.erl`, `dev_reply_id.erl`, and `hb_odysee_node.erl` |
| Generic full-text indexing/search | `dev_search.erl` and `hb_search.erl` |
| SDK routing, discovery, hydration, source merging, revision projection, and Redux shape | `odysee-frontend/ui/lbry.ts`, `ui/util/hyperbeam.ts`, and focused integration services |
| Cookie or server-held signer boundary | `odysee-frontend/web/src/` SSR routes |
| Rendering and interaction only | React components |

Search for existing helpers before adding an abstraction. On the backend check
`hb_ao`, `hb_maps`, `hb_message`, and the existing Odysee modules. On the
frontend preserve the facade and shared normalization path.

## Identity rules

| Object | Identity |
| --- | --- |
| Native HyperBEAM message | Immutable commitment ID |
| Legacy claim output | Immutable `<txid>:<nout>` outpoint |
| Legacy transaction | Display-order 64-character transaction ID |
| Legacy blob | 96-character SHA-384 hash |
| Stream descriptor | SHA-384 `sd_hash` |
| Legacy claim | 40-character mutable locator/reference ID |
| URI or name | Mutable lookup input |
| Search/query result | Immutable message locator |
| Native upload revision | Physical message ID plus signed logical root/version references |

Never replace an immutable outpoint or native ID with a mutable claim ID during
search, hydration, playback, cache reads, or Redux ingestion.

## Authentication rules

- Normal committed writes use `auth-hook@1.0` with `odysee-auth@1.0` as the
  secret provider and `reply-id@1.0` after persistence.
- The hook is gated to commit-flag or token-bearing requests; ordinary reads
  must not receive an auth challenge.
- Production tokens must resolve to an account through the node-owned session
  map or account API. Fail closed for unknown tokens and fail distinctly for an
  unavailable account service.
- `odysee-auth-allow-unvalidated-tokens` is explicitly development-only.
- Derive a stable identity from the account, not a session, when an account
  source is configured.
- PBKDF2 policy belongs to node options. Reject request attempts to choose a
  secret, salt, algorithm, iterations, key length, or ignored-key list.
- Same-origin bridges may forward cookies/tokens because browsers cannot send
  Odysee cookies cross-origin. They are transport/security boundaries, never a
  second data mode.

## Upload rules

- Media and metadata are ordinary messages written through generic `/id`.
- Root records use `schema: odysee-upload@1.0`, `type: upload`, and retain the
  immutable media `data-id`.
- Updates/deletes are append-only snapshots with the same owner/root/data/name
  and creation time, contiguous revision number, current previous reference,
  and a signed stable `version-ref`.
- Reject forks, gaps, owner changes, immutable-field changes, invalid
  operations, and all revisions after a valid tombstone.
- A query locator's physical RSA-PSS commitment ID can differ after serving;
  do not use that transport-sensitive ID as the logical revision link.
- The current UI mutation bridge is
  `/$/api/hyperbeam-upload/v1/write`. Old route names that invoke
  `~odysee-upload@1.0` are dormant cleanup debt and must not be reused.

## Local operation

The normal local services are:

| Service | Default address |
| --- | --- |
| HyperBEAM write/seed node | `http://127.0.0.1:18800` in the demo |
| Frontend SSR | `http://localhost:9090` |

Build the preloaded device store with `rebar3 device local` after backend
device changes. `rebar3 compile` alone can leave a manual node running old
published code. Run only one frontend `dev:web-server` supervisor.

## Validation

Choose the broadest practical check for the touched boundary.

Backend baseline:

```sh
rebar3 device test --with-core
```

Frontend baseline:

```sh
cd odysee-frontend
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
node --check web/src/odyseeHyperbeamNode.js
node --check web/src/fetchStreamUrl.js
```

Focused integration checks:

```sh
pnpm run test:native-upload-revisions
pnpm run test:hyperbeam-upload-smoke
pnpm run test:hyperbeam-query-comment-smoke
pnpm run test:native-comment-revisions
pnpm run test:native-comment-controls
pnpm run test:static-manifest
```

For user-facing flows, verify the real browser/HTTP path. Passing a unit test
does not prove auth forwarding, query projection, byte serving, or rendering.
Always run `git diff --check` before finishing and report unrun checks.

## Documentation and Git hygiene

- Update `README.md` and the relevant `AGENTS.md` when architecture, ownership,
  public contracts, run commands, validation, or limitations change.
- Keep detailed branch-specific investigations in `aidocs/` when useful.
- Preserve unrelated user changes and the staged/unstaged split of an active
  merge. Never reset or revert work you did not create.
- Do not commit unless the user explicitly requests it.
- Do not commit credentials, caches, build output, dependency trees, raw
  transcripts, or database dumps.
- Avoid comments that only narrate code. Explain only non-obvious contracts.
- Continue through implementation, validation, cleanup, and documentation
  unless the user pauses the work or a real external blocker remains.
