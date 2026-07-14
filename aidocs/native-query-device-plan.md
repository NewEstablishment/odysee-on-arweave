# Native Query Device Execution Plan

Source of truth: the 2026-07-13 integration review, especially Sam's direction on immutable ID writes, generic store reads, `query@1.0`, references, and the separation between native comments and historical imports.

## Objective

Make new comments native HyperBEAM messages that are signed and persisted through the generic write path, discoverable as IDs through `query@1.0`, and readable through generic ID resolution. Preserve existing historical comments through the current compatibility source without turning that source into the architecture for new comments.

This is an exact-message discovery task. It is separate from fuzzy Odysee content search, which remains backed by Meilisearch for now.

## Required Laws

1. A new comment is posted through `POST /id?!=true` as a structured message.
2. The auth hook removes private authentication material, signs the message, and persists it in the node's configured store.
3. The write response yields an immutable ID.
4. `query@1.0` matches stable top-level selectors and returns IDs or paths by default, not hydrated comment objects.
5. Each result is hydrated only through bare `GET /<id>`.
6. A missing match is an empty result, not an exceptional query failure.
7. Query ordering and pagination are deterministic and operate before hydration.
8. The reverse index and messages survive an LMDB stop/start cycle.
9. Historical Commentron reads remain a compatibility source and are merged at the frontend boundary until import policy is decided.
10. HyperBEAM-uploaded videos use the same comment flow as legacy videos.

## Canonical Native Comment Shape

The persisted message has stable selector fields at its top level:

- `type`: `comment`
- `target`: immutable or compatibility content identifier currently used by the page
- `parent`: parent comment ID, or `root` for a top-level comment
- `state`: `active`
- `author`: signing channel claim ID
- `schema`: `odysee-comment@1.0`

The message also carries the display and verification surface already expected by the Odysee UI: comment text, claim ID, channel ID/name, parent ID when present, timestamp, LBRY channel signature and signing timestamp, mentions, sticker/support fields, and the HyperBEAM commitment produced by the auth hook.

The immutable HyperBEAM message ID is the comment ID. It is returned to the UI after the write and injected into the hydrated UI object; it is not self-referential data inside the stored message.

## Query Contract

The generic device remains `query@1.0`; no `odysee-query` device is introduced.

Comment discovery uses `only` with exact selector keys. Content discussions match `type`, `target`, `parent`, and `state`. Author views match `type`, `author`, and `state`.

The generic query device must support:

- `return=paths` as the default ID-only result
- `return=count` for pagination totals
- `sort-by` and `sort-order`
- `offset` and `limit`
- successful empty arrays/counts/booleans for no matches
- stable path tie-breaking when sort values are equal

Pagination metadata is composed by the frontend after native and historical pages are merged. To preserve a deterministic combined page, the frontend fetches both sources from the beginning through the requested page boundary, merges and deduplicates them, applies the requested comment sort, and then slices the requested page.

## Implementation Phases

### 1. Generic Query Semantics

- Exclude query-control fields from match templates.
- Keep count and boolean based on the complete match set.
- Sort matches by an optional message key with stable ID tie-breaking.
- Apply non-negative offset and limit before returning paths or messages.
- Return empty collections or zero for missing matches.
- Keep `first` variants as not-found when no result exists.

### 2. Native Comment Write

- Add a frontend generic structured-message writer using the existing HyperBEAM base URL and Odysee auth header.
- Build only the canonical public comment fields; do not persist auth tokens or payment intent secrets.
- Parse the generic write response and return a complete Commentron-compatible comment object to Redux.
- Keep Commentron dry-run behavior for payment validation because dry runs must not create immutable messages.

### 3. Native Comment Discovery And Read

- Query native comment IDs without authentication material.
- Resolve each ID through the generic store path.
- Verify the resolved shape is a native comment before accepting it.
- Normalize the message into the existing UI comment shape and set its comment ID from the resolved path.
- Fall back to the compatibility by-ID device only when a generic native read is not a comment.

### 4. Historical Compatibility Merge

- Keep historical comments sourced through the existing HyperBEAM-facing Commentron adapter.
- Merge native and historical results by comment ID.
- Preserve newest, oldest, popularity, controversy, and no-pin sort modes deterministically.
- Compute combined pagination metadata.
- If one source fails, return the other source when it has a valid result; fail only when neither source can answer.

### 5. Verification

- Unit-test query empty results, sorting, limits, offsets, total counts, and ID-only behavior.
- Unit-test a signed native comment queried by selectors and read back by returned ID.
- Test the same query after stopping and restarting an LMDB store.
- Add a live smoke that posts a signed JSON comment, queries its ID, excludes a different target, and reads the message back by ID.
- Run focused HyperBEAM device tests and compilation.
- Run frontend type/format checks for every edited file.
- Exercise the local HyperBEAM and web application flow.

## Explicit Boundaries

- Meilisearch remains the current fuzzy/full-text claim search backend and is not replaced by this device work.
- Channel catalogs should use `reference@1.0`; this comment query work must not be copied into channel-page discovery.
- Historical comment bulk import is a separate decision.
- Native edit, moderation, reaction, and deletion state need an agreed append-only event/reference model. This milestone does not invent mutable semantics or silently mutate immutable comment messages. Existing compatibility operations remain in place until that model is specified.

## Audit Gates

- No new Odysee-specific query device or REST-shaped backend is introduced.
- Query responses used by the UI contain IDs before hydration.
- Generic reads, not query response objects, supply comment data.
- Public query reads do not carry or persist auth tokens.
- Native writes are signed and private fields are absent from stored messages.
- Empty queries are successful.
- Pagination is stable across repeated calls.
- LMDB persistence is proven.
- Existing legacy comment display is retained.
- HyperBEAM-uploaded content no longer suppresses comments.
- The worktree contains only scoped source, tests, and documentation changes.

## Execution Status - 2026-07-14

The native comment milestone is implemented and verified.

- `query@1.0` excludes query-control fields from selector matching, returns successful empty results, supports deterministic sorting and pagination, and keeps count and boolean operations based on the complete match set.
- Reverse-index aliases are deduplicated by commitment-free payload identity and normalized to the canonical message ID returned by `POST /id?!=true`. Query results therefore resolve through the same bare `GET /<id>` contract as the write response.
- New non-dry-run comments are written as signed structured messages through the existing same-origin HyperBEAM write proxy. Authentication remains an HTTP input to the auth hook and is not persisted in the message.
- Native comment lists query IDs through `~query@1.0`, hydrate every result through generic store reads, merge with the historical Commentron source, sort deterministically, and then slice the requested page.
- Native by-ID reads use the generic store path first. The compatibility comment device is used only when that path does not yield a native comment.
- HyperBEAM-uploaded content now follows the same comment list path as legacy content.
- The LBRY channel signature is stored as `channel-signature`. The top-level `signature` key is reserved by HyperBEAM HTTP-signature handling and must not be used for application signature data.

Verification completed:

- `rebar3 device test --module dev_query`: 15 of 15 tests passed, including empty results, stable ordering, pagination, active-state filtering, canonical write/query ID equality, generic readback, LMDB restart persistence, and signer metadata recovery.
- `pnpm run test:hyperbeam-query-comment-smoke`: passed through the running web proxy and HyperBEAM node. The write ID, query-returned ID, and generic read ID were identical; a missing target returned an empty list; signer metadata was present; private auth material was absent.
- `pnpm run build` passed. Its duplicate-icon-key, ES2015 BigInt/import-meta, and chunk-size notices are existing build warnings outside this change.
- Focused frontend format, type-aware lint/type checking, route syntax checking, conflict-marker scanning, and `git diff --check` passed.

Deletion is represented in discovery by immutable messages with `state=deleted`; active comment queries require `state=active`, and this exclusion is covered by the device tests. Creating the append-only delete/edit/moderation event and updating a current-state reference remain outside this milestone because the meeting did not define their authorization and reference model.
