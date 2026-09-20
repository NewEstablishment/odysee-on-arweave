# Legacy comment migration pilot

Status: proposed, source-reviewed 2026-09-14 at `f02aabb`. No live database
connection, export, import, application changes or deployment performed.

## Source findings

- `../odysee/internal-apis/app/model/comment_v2.go` stores comment IDs,
  content/commenter publish IDs, numeric parent relationships and timestamps,
  not comment bodies/signatures. Export joins must translate numeric parent IDs
  back to legacy comment IDs and publish IDs back to claim IDs.
- `../odysee/internal-apis/app/util/commentron.go` reads bodies from Commentron.
- Its pinned dependency is `github.com/OdyseeTeam/commentron` at
  `v0.0.0-20250624195630-ac1b82c8261b`, available in the local Go module cache.
  `model/comment.go` contains body, signature, signingts, parent/claim/channel
  IDs, hidden/pinned/flagged/protected flags and deleted_at.
- The dependency's `server/services/v1/comments/edit.go` overwrites body and
  signature, preserving the original timestamp. A current snapshot cannot
  reconstruct every historical edit; backups/change logs would be needed.
- `server/lbry/validator.go` signs timestamp + reversed channel ID + text.
  This signature does not bind video ID, parent, pin or moderation state.
  Channel evidence must authenticate the key; a current key may not validate
  an older comment after channel key rotation.
- Current `ui/util/hyperbeam.ts` comment list/by-ID paths are native-only.
  Importing rows alone will not make historical comments appear correctly.

## Recommended scope

Pilot one public legacy video with a small known root/reply thread. Use a
read-only, allowlisted Commentron export or public list/by-ID reads for a sample.
Prefer a consistent database snapshot for eventual full migration; public API
pagination can drift and cannot establish complete deleted/protected history.
Repository access does not establish live database access or deployed-version parity.

1. Export and validate: normalize an allowlisted JSONL format; report counts,
   duplicate IDs, missing parents, invalid signatures and excluded records.
   Keep private export material outside public cache/Git. Exclude deleted,
   hidden, flagged and protected bodies from the public pilot; suppress orphan
   descendants or use body-free placeholders under an explicit policy.
2. Import: use a distinct historical-evidence schema through generic committed
   `/id` writes. Retain legacy ID, target, parent, original text/signature,
   source snapshot digest and provenance. Bind acceptance to a configured
   migration authority, not any arbitrary importer signer. The importer is an
   attestor, never the original native author. Keep signature-covered facts
   separate from source-attested placement/moderation facts.
3. Resume safely: checkpoint legacy ID + normalized source-version digest to
   exact stored ID; recover acknowledged writes and prevent duplicate display
   on replay. Reconcile ambiguous write responses before retrying. Publish a
   verified batch manifest only after readback, allowing incomplete batches to
   remain invisible. Withdrawal is discovery policy, not erasure of public data.
4. Integrate: query locators and exact-hydrate at the existing frontend boundary;
   merge historical and native threads before hierarchy/count/pagination.
   Preserve the full legacy claim ID as the thread locator and record the
   observed immutable outpoint separately; do not silently reassign the thread
   to one video version. Imported comments remain read-only until a separate
   verified legacy-channel-to-native-owner binding exists. New native replies
   can reference a namespaced stable historical comment identity.

## Commit-sized deliverables and demonstration

- Export/validation CLI plus safe fixtures and contract tests (first deliverable).
- Generic import CLI with checkpoint/replay, signer allowlist and exact-read tests.
- Historical/native comment integration with browser thread/reload tests.

Demo acceptance: known roots and replies render, importer rerun does not duplicate
them, a new native reply survives refresh, source services can be unavailable
after import, and no browser request reaches Commentron. Tampered payloads,
foreign importers and restricted bodies do not render as approved history.

Do not promise full migration today. First confirm one approved public target,
the read-only source/export, deployed schema, and migration signer/trust policy.
Full migration needs a cutover/delta strategy (including edits/deletes), historical
key resolution, scale tests, moderation reconciliation and independent counts.
Google Auth is not required for read-only history; editing old authors' comments
requires separately proven ownership, not merely a matching Google login.
