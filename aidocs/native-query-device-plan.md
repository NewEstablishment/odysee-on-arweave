# Native Comment Query Integration Plan

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
6. The integration layer maps the stock device's not-found result to an empty collection.
7. Ordering, reply grouping, counts, and pagination happen after ID hydration in the Odysee integration layer.
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

Comment discovery uses `only` with exact selector keys. Content discussions match `type`, `target`, and `state`; parent grouping happens after hydration. Author views match `type`, `author`, and `state`.

The existing generic query device is consumed unchanged. Odysee calls `~query@1.0/only` with exact selector fields and `return=paths`. It does not add a batch endpoint, comment-specific behavior, sorting, pagination, or empty-result semantics to the device.

For a content discussion, one query selects all active comments for the target. The integration layer resolves each returned ID, removes duplicate cache representations of the same signed comment, groups messages by `parent`, derives reply counts, sorts the hydrated comments, and slices the requested page. A repeated list request for the same target may reuse the in-flight or short-lived resolved collection.

Pagination metadata is composed by the frontend after native and historical pages are merged. To preserve a deterministic combined page, the frontend fetches both sources from the beginning through the requested page boundary, merges and deduplicates them, applies the requested comment sort, and then slices the requested page.

## Implementation Phases

### 1. Stock Query Integration

- Leave `dev_query.erl` identical to upstream.
- Use one exact `only` query per target or author collection.
- Request paths only and hydrate each path through the generic store read.
- Treat a not-found query response as an empty source at the integration boundary.
- Keep all Odysee comment grouping, counting, sorting, deduplication, and pagination outside the device.

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

- Test a signed native comment queried by selectors and read back by returned ID.
- Add a live smoke that posts a signed JSON comment and reply, performs one target-wide stock query, excludes a different target, resolves the IDs, and derives the hierarchy outside the device.
- Run HyperBEAM compilation without maintaining an Odysee fork of the query-device tests.
- Run frontend type/format checks for every edited file.
- Exercise the local HyperBEAM and web application flow.

## Explicit Boundaries

- Meilisearch remains the current fuzzy/full-text claim search backend and is not replaced by this device work.
- Channel catalogs should use `reference@1.0`; this comment query work must not be copied into channel-page discovery.
- Historical comment bulk import is a separate decision.
- Native edit, moderation, reaction, and deletion state need an agreed append-only event/reference model. This milestone does not invent mutable semantics or silently mutate immutable comment messages. Existing compatibility operations remain in place until that model is specified.

## Audit Gates

- No new Odysee-specific query device or REST-shaped backend is introduced.
- The upstream generic query device has no Odysee branch modifications.
- Query responses used by the UI contain IDs before hydration.
- Generic reads, not query response objects, supply comment data.
- Public query reads do not carry or persist auth tokens.
- Native writes are signed and private fields are absent from stored messages.
- Empty device results are normalized by the integration layer.
- Hydrated ordering and pagination are stable across repeated calls.
- LMDB persistence is proven.
- Existing legacy comment display is retained.
- HyperBEAM-uploaded content no longer suppresses comments.
- The worktree contains only scoped source, tests, and documentation changes.

## Architecture Correction - 2026-07-15

The first implementation incorrectly extended `dev_query.erl` with batching, sorting, pagination, empty-result handling, and Odysee-driven deduplication. Those changes are removed. The corrected implementation treats `query@1.0` as an existing generic primitive and keeps product orchestration at the integration boundary.

- New non-dry-run comments are written as signed structured messages through the existing same-origin HyperBEAM write proxy. Authentication remains an HTTP input to the auth hook and is not persisted in the message.
- Native comment lists issue one stock `only` query for the relevant target or author, hydrate every returned ID through generic store reads, group replies and derive counts locally, merge with the historical Commentron source, sort deterministically, and then slice the requested page.
- Duplicate HTTP/cache representations are collapsed using the signed comment identity while preferring the original stored message ID.
- Native by-ID reads use the generic store path first. The compatibility comment device is used only when that path does not yield a native comment.
- HyperBEAM-uploaded content now follows the same comment list path as legacy content.
- The LBRY channel signature is stored as `channel-signature`. The top-level `signature` key is reserved by HyperBEAM HTTP-signature handling and must not be used for application signature data.

Deletion is represented in discovery by immutable messages with `state=deleted`; active comment queries require `state=active`. Creating the append-only delete/edit/moderation event and updating a current-state reference remain outside this milestone because the meeting did not define their authorization and reference model.
