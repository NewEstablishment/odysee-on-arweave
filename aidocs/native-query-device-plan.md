# Native Comment Query Integration Plan

Source of truth: the 2026-07-13 integration review, especially Sam's direction on immutable ID writes, generic store reads, `query@1.0`, references, and the separation between native comments and historical imports.

## Objective

Make new comments and their edits native HyperBEAM messages that are signed and persisted through the generic write path, discoverable as IDs through `query@1.0`, and readable through generic ID resolution. Preserve existing historical comments through the current compatibility source without turning that source into the architecture for new comments.

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
11. Editing a native comment appends a new immutable signed revision. It never mutates the root message or adds mutable behavior to `query@1.0`.
12. Comment visibility, pinning, creator hearts, and creator-channel blocks are append-only signed control messages projected after generic ID hydration.

## Canonical Native Comment Shape

The persisted message has stable selector fields at its top level:

- `type`: `comment`
- `target`: immutable or compatibility content identifier currently used by the page
- `parent`: parent comment ID, or `root` for a top-level comment
- `state`: `active`
- `author`: signing channel claim ID
- `schema`: `odysee-comment@1.0`

The message also carries the display and verification surface already expected by the Odysee UI: comment text, claim ID, channel ID/name, parent ID when present, timestamp, LBRY channel signature and signing timestamp, mentions, sticker/support fields, and the HyperBEAM commitment produced by the auth hook.

The initial immutable HyperBEAM message ID is the stable logical comment ID. It is returned to the UI after the write and injected into the hydrated UI object; it is not self-referential data inside the stored message. Every edit has its own immutable physical message ID while retaining the root ID as its logical comment ID.

## Native Edit Revision Contract

An edit is a complete replacement comment message with the same target, parent, author, channel, and original timestamp as its root. It adds:

- `revision-of`: stable root comment ID
- `previous-version`: immutable physical ID of the preceding version
- `revision`: preceding revision number plus one
- `revision-timestamp`: edit ordering timestamp
- `operation`: `edit`
- `updated-at`: display timestamp for the edit

The first edit points `previous-version` at the root ID. Later edits form a linear append-only chain. The UI queries revisions with an exact `revision-of` selector, hydrates their immutable IDs, validates the chain, and exposes the latest valid message under the stable root comment ID. Physical duplicates are deduplicated only by `hyperbeam_message_id`; deduplicating by logical comment ID before chain selection would discard revisions.

New native roots and revisions use `signature-scope=native-comment-v1`. The LBRY channel signature covers a deterministic statement containing the comment text and identity, target, parent, state, original timestamp, revision root, previous physical version, revision number, revision timestamp, and operation. Each hydrated message is verified through the existing `odysee-comment@1.0/verify-signature` path before it can participate in a revision chain. The HTTP signature identifies the HyperBEAM node and is not used as comment ownership. Older native roots without this signature scope remain readable through their historical text-only channel signature.

## Query Contract

The generic device remains `query@1.0`; no `odysee-query` device is introduced.

Comment discovery uses `only` with exact selector keys. Content discussions match `type`, `target`, and `state`; parent grouping happens after hydration. Author views match `type`, `author`, and `state`.

The existing generic query device is consumed unchanged. Odysee calls `~query@1.0/only` with exact selector fields and `return=paths`. It does not add a batch endpoint, comment-specific behavior, sorting, pagination, or empty-result semantics to the device.

For a content discussion, one query selects all active comments for the target. The integration layer resolves each returned ID, removes duplicate cache representations of the same signed comment, groups messages by `parent`, derives reply counts, sorts the hydrated comments, and slices the requested page. A repeated list request for the same target may reuse the in-flight or short-lived resolved collection.

Pagination metadata is composed by the frontend after native and historical pages are merged. To preserve a deterministic combined page, the frontend fetches both sources from the beginning through the requested page boundary, merges and deduplicates them, applies the requested comment sort, and then slices the requested page.

## Native Owner Control Contract

Native moderation state uses immutable messages with `schema=odysee-comment-control@1.0`, `type=comment-control`, and `signature-scope=native-comment-control-v1`. The signed statement covers the control, action, authority, content target, logical comment ID or blocked subject, owner, actor, actor name, event timestamp, optional expiry, and signature scope.

Comment controls use the content claim ID as `target`. Channel blocks use the creator channel ID as both `target` and `owner`. Current state is the latest valid physical event for each logical control key, ordered by event timestamp and then immutable message ID. The event forms are:

- visibility: `hidden` or `visible`, independently keyed for comment-author and content-owner authority
- pin: `pinned` or `unpinned`, authorized only for the content owner
- creator heart: `liked` or `unliked`, authorized only for the content owner
- channel block: `blocked` or `unblocked`, authorized only when actor, owner, and target are the same creator channel; an optional expiry implements timeouts

The integration resolves the content claim to its signing channel before accepting owner events, verifies every event's LBRY channel signature, and verifies author visibility events against the original comment author. Invalid or unauthorized messages remain inert. A hidden, author-deleted, or currently blocked comment is excluded from ordinary lists. Pin and creator-heart state are projected onto otherwise visible comments. Blocked authors cannot create comments through the application path; direct generic writes remain possible but are filtered during projection.

Legacy comments and delegated/global moderation remain on Commentron. Ordinary creator-channel block and unblock operations dual-write the native event and compatibility operation so a single UI decision applies to both native and historical comments during migration. Reaction reads split native IDs from legacy IDs before querying their respective sources and merge the resulting maps at the integration boundary.

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

### 5. Native Edit Revisions

- Resolve the requested ID through the generic native store before deciding whether the operation is native or historical.
- Leave historical edits on the existing Commentron compatibility path.
- Require the active channel to match the verified root author.
- Write a new canonical signed revision through the same generic write route as native comment creation.
- Read and verify the newly stored revision before returning success to Redux.
- Keep the root ID as `comment_id` and the new immutable ID as `hyperbeam_message_id`.
- Discover all revisions with an exact stock query and select only a contiguous, same-owner chain.

### 6. Native Owner Controls

- Write signed visibility, pin, creator-heart, and block events through the generic structured-message path.
- Discover events with exact stock `query@1.0` selectors and hydrate them through generic ID reads.
- Resolve and verify content ownership outside `query@1.0` before projecting an event.
- Keep comment-author deletion separate from content-owner hiding so one authority cannot undo the other's decision.
- Merge native creator-heart state with legacy reaction maps.
- Merge native owner blocks with compatibility block lists and honor timeout expiry.

### 7. Verification

- Test a signed native comment queried by selectors and read back by returned ID.
- Add a live smoke that posts a signed JSON comment and reply, performs one target-wide stock query, excludes a different target, resolves the IDs, and derives the hierarchy outside the device.
- Run HyperBEAM compilation without maintaining an Odysee fork of the query-device tests.
- Run frontend type/format checks for every edited file.
- Exercise the local HyperBEAM and web application flow.

## Explicit Boundaries

- Meilisearch remains the current fuzzy/full-text claim search backend and is not replaced by this device work.
- Channel catalogs should use `reference@1.0`; this comment query work must not be copied into channel-page discovery.
- Historical comment bulk import is a separate decision.
- Delegated and global native moderation authorization is not defined here and remains on the compatibility path.

## Audit Gates

- No new Odysee-specific query device or REST-shaped backend is introduced.
- The upstream generic query device has no Odysee branch modifications.
- Query responses used by the UI contain IDs before hydration.
- Generic reads, not query response objects, supply comment data.
- Public query reads do not carry or persist auth tokens.
- Native writes are signed and private fields are absent from stored messages.
- Native revisions preserve a stable logical ID, have unique physical IDs, and form a verified same-channel chain.
- Tampering with revision linkage or metadata invalidates the application channel signature.
- Native owner-control events are immutable, signature-verified, ownership-checked, and projected outside the query device.
- A comment author cannot pin, creator-heart, or owner-hide their own comment unless that channel also owns the content target.
- Content owners can hide, pin, creator-heart, and block native commenters without mutating the original comment.
- Native block expiry and unblock events deterministically override older block state.
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
- Duplicate HTTP/cache representations are collapsed by immutable physical message ID before root and revision chains are evaluated.
- Native by-ID reads use the generic store path first. The compatibility comment device is used only when that path does not yield a native comment.
- HyperBEAM-uploaded content now follows the same comment list path as legacy content.
- The LBRY channel signature is stored as `channel-signature`. The top-level `signature` key is reserved by HyperBEAM HTTP-signature handling and must not be used for application signature data.

Native editing is implemented as an append-only revision chain outside `query@1.0`. The original immutable message remains the stable logical ID; a valid latest revision is selected only after generic reads and LBRY channel-signature verification. Legacy edits continue through Commentron. Native visibility, pin, creator-heart, and creator-channel block state is projected from the signed append-only control events defined above; the original comments remain immutable.

An owner-authenticated `moderation.BlockedList` compatibility read lazily promotes legacy personal block rows that have no native history into owner-signed native control events. Existing native block or unblock history wins over legacy state, preventing stale legacy rows from reversing native decisions. Imported events record `source-system=legacy-commentron`; later discovery and filtering use the same stock query and generic read path as native controls.
