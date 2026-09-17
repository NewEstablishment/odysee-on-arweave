# Native upload revisions and search projection

Native upload create/edit/delete remains ordinary cookie-signed `/id` writes.
No upload write, revision, or search-proxy device is introduced.

## State and identity

New edits contain complete editable metadata snapshots, including tags,
languages and explicit empty strings/lists. The writer merges unspecified
fields from the verified effective state. Older sparse revisions remain
readable by applying their defined fields in chain order. Media ID, creation
name/time and owner/channel binding stay anchored to the root.

New predecessors are exact immutable message IDs. Existing UUID version
references remain readable using query to locate and verify their messages.
The frontend serializes saves per node/owner/root with Web Locks across tabs
where supported. Persisted version-ID hints cover query lag; every hint is
exact-read and verified, so browser storage cannot grant authority. Conflicting
valid children stop discovery at the last unambiguous state and block further
saves; they are never resolved by taking the largest claimed revision.

Friendly `name#root-id` links and name discovery resolve current state. Explicit
`immutable_<ID>` routes read that version, including prior playlist items.
Tombstones remove an upload from current discovery; immutable history/media
remain addressable. Deletion is not access revocation or byte erasure.

## Search ownership

`scripts/reindex-node-uploads-to-search.mjs --watch` is an operator process,
alongside Meilisearch. It exact-reads uploads, verifies the selected commitment
and its committer, loads linked metadata, and applies the same TypeScript
revision projector as browser hydration. Claimed channel attribution is indexed
only after the profile verifies under the same owner.

Each logical root has one hashed search key. Its `id` points to the selected
stored immutable revision, never to a synthetic merged object. Full document
replacement preserves explicit clears. Reconciliation removes obsolete native
upload search documents, not stored messages or historical LBRY documents.
Transport/discovery errors abort before changing the index. Run one worker per
index; periodic retry repairs interrupted indexing. Search is eventually
consistent and writes remain successful if the worker/search service is down.

The generic cache-write search marker excludes `odysee-upload@1.0`, preventing
raw revisions from taking ranked page slots. Other generic indexing continues.
Public channel/Following queries use the shared search corpus and server-side
filter/sort/offset. Owner-library enumeration remains exact query plus verified
projection. Generic search/query devices contain no Odysee revision rules.

The worker's index credentials are environment-only and never reach the browser.
Use `--dry-run` to inspect selected locators. This is native-partition
reconciliation, not replacement of the full historical search index; retain the
existing staging/checkpoint importer for whole-corpus rebuilds.

## Validation

`test:native-upload-revisions` covers metadata, clears, index-lag serialization,
equivalent commitments, foreign revisions and forks, plus search projection.
`test:native-cookie-upload-revisions` runs create/edit/foreign-delete/owner-delete,
reconciliation, and exact-history checks against isolated node/search services.

The Playwright `tests/specs/native/hyperbeam-upload-revisions.spec.ts` checks
the actual manifest editor, metadata clearing, reload and exact root/revision
history. Set `HYPERBEAM_MANIFEST_URL` to an isolated published manifest.

2026-09-09 local results: frontend contracts, TypeScript, formatting/lint
(six pre-existing warnings), static manifest build, backend compile and all
357 device/core tests passed. The live upload/search lifecycle and cookie
comments/reactions/playlists/subscriptions/preferences checks passed. Chromium
confirmed title edit, description clear, tag/language preservation, refresh,
and exact original history. The separate EUnit run timed out in
`dev_analytics:register_requires_auth_test` while initializing the volatile
store; it did not complete and must not be counted as passing.

## Acceptance limits

This closes the immediate upload/search implementation defects, not the entire
broad-release audit. The index worker scans the native partition each cycle;
incremental checkpoints and production-scale load/failover remain follow-up work.
Reconciliation is replayable, not an atomic whole-corpus index swap.
Cross-device simultaneous writers and ambiguous/lost write responses still need
a recovery UX; conflicting chains fail closed, with no automatic merge.
Delayed-index serialization has a deterministic regression, not a full network
chaos or multi-browser acceptance test. Mixed historical/native Following and
playlist rendering still need a populated historical-node rehearsal.
Legacy `has_source`/`has_no_source` search facets are not added: the existing
historical index lacks that authoritative field. Do not filter existing legacy
documents against a native-only facet and silently hide them.
