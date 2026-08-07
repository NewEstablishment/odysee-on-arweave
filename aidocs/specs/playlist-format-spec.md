# Playlist Format Specification

Date: 2026-08-07 (rev 2). One format. Every playlist — new or imported — is a
native committed message. Legacy on-chain collections are *transformed* into
this format at the read boundary; their old identifiers survive only as
resolution keys.

---

## 1. The playlist message

A plain committed HyperBEAM message. No device, no private state.

| Key | Type | Rule |
| --- | --- | --- |
| `type` | `playlist` | Query selector. |
| `schema` | `odysee-playlist@1` | Query selector; versioned. |
| `author` | immutable ID | The owning channel's root immutable ID (a channel is a claim like any other); resolved like an entry. |
| `title` | binary | Required, non-empty. |
| `description` | binary | Optional. |
| `thumbnail` | binary (url) | Optional. |
| `items` | binary | Ordered entries, comma-joined. Entry = `<root>[@<pinned>]`: `root` = logical immutable ID (native message ID, or the create-outpoint for imported content), `pinned` = optional immutable version. Claim-ids are invalid; writers MUST reject them. |
| `revision-of` | ID | Logical root message ID; absent on the first version. |
| `previous-version` | ID | Prior revision's physical ID; absent on the first version. |
| `revision` | int | Monotonic from 0. |
| `state` | `active` \| `deleted` | `deleted` = tombstone. |
| `legacy-claim-id` | 40-hex | **Imported playlists only.** Resolution key for old URLs and import dedup. Never used as an entry or read key. |
| `legacy-outpoint` | `<txid>:<nout>` | Imported only: the collection version that was transformed. |
| `owner-signature`, `signing-ts` | binary | Channel signature over the canonical statement (§3). Absent on unadopted imports (§5). |

Identity: the message ID is the playlist version; the root message ID is the
playlist's logical identity and its canonical URL id (`/$/playlist/<root-id>`).

## 2. Writes

`POST /<path>?!=true` → stock `~auth-hook@1.0` signs with the node-held
per-user wallet → `persist@1.0` stores and replies `message-id`. The wallet
commitment is transport identity only; ownership comes from §3.

## 3. Ownership

`owner-signature` = secp256k1 channel signature over
`sha256(signing_ts || reverse(channel_id_bytes) || canonical_payload)`,
`canonical_payload` covering `title, description, thumbnail, items, state,
revision, revision-of, previous-version` in a fixed serialization (pin the
exact bytes with the team; reuse the comment convention). Verified against the
channel's committed public key. Interim: produced via legacy `channel_sign`
until native creator authority lands — same as comments.

## 4. Revision law (editability)

Current state of playlist `R` = message `M` where:
1. `M.revision-of = R` (or `M = R` with no revisions);
2. the chain `R ← … ← M` is contiguous in `revision` and linked by
   `previous-version`;
3. every link is owner-signed by `R.author`;
4. highest valid revision wins; tie-break = lowest physical ID. No timestamps.

Foreign or malformed revisions are ignored and reported. `state=deleted` at
the head hides the playlist; history stays addressable.

## 5. Legacy transformation (import)

Every legacy on-chain collection becomes a playlist message, lazily,
on first access — the pull-through pattern. The transformer (store boundary,
same layer as `hb_store_odysee`):

1. Resolves the legacy claim-id → current collection outpoint; fetches and
   verifies the raw claim (existing collection-decode path).
2. Resolves each entry claim-id → outpoint (one batched SDK locator
   lookup) → entry `root`. Per the meeting record (Sam, 07-20: legacy data
   gets no new IDs; 07-24: discovery returns immutable LBRY transaction
   IDs; 08-05: extend `is_id`/`ao-id:` so these are first-class HyperBEAM
   IDs), imported content keeps its chain-native immutable identity.
3. Emits the playlist message: metadata copied; `author` = the signing
   channel's outpoint; `legacy-claim-id`/`legacy-outpoint` set;
   **no `owner-signature`** — the import is provenance-backed (derived from
   verified chain evidence), not owner-authored.
4. Writes it to the cache under its committed ID; `~query@1.0` discovers it
   like any native playlist. Idempotent: an existing message with the same
   `legacy-outpoint` is returned, not duplicated.

Unadopted imports are read-only. **Adoption**: the channel owner authenticates
and signs revision 1 over the imported root — from then on the normal
revision law applies and the legacy chain is irrelevant. Re-import after the
legacy collection changed produces a new unadopted import version; adopted
playlists never re-import.

## 6. Resolution

| Input | Behavior |
| --- | --- |
| `/$/playlist/<root-message-id>` | Canonical. Read root, query `revision-of=<root>` for the head. |
| `/$/playlist/<40hex>` (old URL) | Compatibility input only: claim-id → import-or-find via `legacy-claim-id` → redirect/render the native playlist. |
| Entry `root` (native) | Latest = `revision-of` query (consumes the upload revision contract, owned elsewhere). |
| Entry `root` (imported outpoint) | Latest = store-internal root→current resolution; `pinned` read is exact. |
| Reference device (when pinned upstream) | `root` MAY be a reference ID; resolution swaps, schema unchanged. |

## 7. Privacy (deferred on TEE/auth key custody)

Same envelope, sealed content: `type/schema/author/revision-of/revision/state`
stay plaintext (the revision law runs on them); `title/description/thumbnail/
items` are replaced by one `sealed` field (ciphertext; key wrapped by the
user's TEE-held wallet). Publish/privatize = a revision swapping plaintext ↔
`sealed`; no migration. Unlisted needs no mechanism: unindexed = reachable
only by ID.

## 8. Security properties

- No node can forge a playlist, a revision, or an entry list (channel
  signature; committed content; explicit all-commitment verification).
- No hijack (foreign signatures ignored) and no silent rollback (monotonic
  counters, deterministic forks).
- Imports are exactly as trustworthy as their chain evidence; they are
  labeled unadopted until owner-signed, and the SDK proxy can at worst hide
  or reorder locator lookups (liveness, not integrity).

## 9. Executable conformance criteria

1. Write → read by ID → explicit all-commitment verify → restart → identical.
2. Owner revision supersedes; foreign revision ignored; broken chain ignored.
3. Tombstone hides from projection; history addressable.
4. `~query@1.0` finds the playlist by `schema+author`; hydration preserves
   `items` order.
5. Claim-id entries rejected at write validation.
6. Import: transformed entries match the SDK's list for the same collection,
   in order; import is idempotent by `legacy-outpoint`; tampered source bytes
   fail closed, nothing is emitted.
7. Old-URL resolution lands on the same native playlist every time.
8. Adoption: owner-signed revision over an import starts a valid chain;
   unadopted imports reject edits.
9. Privacy variant: sealed head yields no plaintext to non-owners;
   publish/privatize round-trip preserves the chain.

## 10. Open decisions

1. Canonical signature payload serialization (pin exact bytes; align with
   comments).
2. Entry encoding `<root>[@<pinned>]` vs two parallel fields.
3. Write-time entry-count bound (e.g. 5k) to bound hydration.
4. Import authorship edge cases: anonymous collections (no signing channel)
   — importable as ownerless or skipped?
5. Whether the transformer runs node-side on old-URL access only, or also as
   a bulk pass when the snapshot pipeline lands.
6. Native comments still carry 40-hex channel ids in `author`; align them
   with the playlist rule (root immutable ID) in the same sweep.
