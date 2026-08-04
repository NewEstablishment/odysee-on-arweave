# Data sourcing

The legacy Odysee endpoints the seed stores consume, what each is trusted for,
and the exact verification obligations of every store module. The governing
principle (see [architecture.md](architecture.md#trust-model)): legacy
infrastructure is an **untrusted locator and transport**. It may point us at
data and carry bytes; it may not assert facts. Every served fact is re-derived
from raw bytes per the recipes in [lbry-data-model.md](lbry-data-model.md).

## Legacy endpoints

### SDK proxy — locator only

`POST https://api.na-backend.odysee.com/api/v1/proxy?m=<method>`, JSON-RPC 2.0.
Methods used:

- `resolve` (by `lbry://` URL) and `claim_search` (by claim IDs / channel ID)
  — return pre-digested claim JSON. Trusted **only** for hints: `txid`,
  `nout`, the `sd_hash` hint, and the signing channel's claim-id hint. Every
  one of these is subsequently proven or contradicted by raw bytes. The
  decoded `value` JSON is never served from this source.
- `transaction_show` (by txid) — returns `{hex: <raw_tx_hex>}`. The one SDK
  method whose payload **is** trustlessly verifiable: raw bytes, checked by
  txid recomputation. This is the backbone of the system.

Odysee web URLs convert to `lbry://` form before resolution (`:` → `#`).

### Blob CDN — fully verifiable

`GET http://blobcache-eu.odycdn.com:5569/blob?hash=<sha384hex>`; alternate
bases `blobcache-us.odycdn.com`, `blobcache.lbry.com`. Optional `edge_token`
query parameter; HTTP 403 signals a protected blob. The transport is
irrelevant to trust: blobs are self-addressing (`sha384(bytes)` must equal the
requested hash), so any mirror — or cache, or peer — is as good as the origin.

### Player CDN — not used on the trustless path

`player.odycdn.com` serves transcoded/progressive media
(`/api/v3/streams/free/<name>/<claim_id>/<sd6>.mp4`). The bytes it returns are
not, in general, the descriptor plaintext, and nothing binds them to any
commitment. It is an opaque, unverifiable fallback for legacy playback and is
excluded from the trustless serving path; verified playback reconstructs media
from hash-checked blobs.

### Commentron — legacy comments, per-item verifiable

`POST https://comments.odysee.tv/api/v2?m=<method>` (JSON-RPC:
`comment.List`, `comment.ByID`, `reaction.List`). Historical comments carry
their channel signature and signing timestamp, so each comment is
individually verifiable given the channel's committed public key:

```
digest = sha256( signing_ts_utf8 || reverse(channel_id_bytes) || comment_bytes )
```

64-byte compact secp256k1 signature (hex), verified as ECDSA/SHA-256 against
the channel key from raw channel evidence. Comments failing the check are
labeled or dropped by the reader. Legacy comment *writes* and moderation
methods are not part of this system; native writes replace them
([architecture.md](architecture.md#writes)).

### internal-apis — unverifiable aggregates

`https://api.odysee.com` (`/file/view_count`, `/reaction/list`,
`/subscription/sub_count`, account flows). Server-side counters with no
verifiable representation. Progressive enhancement only: the UI may display
them; nothing depends on them, and no store commits them.

### chainquery / lighthouse / Meilisearch — discovery only

The chainquery SQL mirror, the legacy lighthouse search service, and any
Meilisearch index built from them return pre-digested rows or name/claim-id
pairs. They are discovery aids: useful for finding outpoints to verify
(chainquery rows carry `transaction_hash_id`/`vout`, so any row can be
upgraded to trustless by refetching the raw transaction), never served as
fact. Native content discovery uses `~query@1.0`'s exact-match index instead.

## Store modules

Each store performs its own HTTP against the endpoints above (through
HyperBEAM's HTTP client), verifies **before** constructing a message, and
returns a fully-formed evidence message whose commitments carry
`commitment-device => <<"lbry@1.0">>`. Misses return `{error, not_found}` so
the store stack falls through; transient upstream failures return
`{failure, Reason}` (triggering the dispatcher's retry). Non-LBRY-shaped keys
are rejected without network I/O.

### `hb_store_lbry_transaction`

- **Keys**: bare 64-hex txid.
- **Fetches**: `transaction_show` via the SDK proxy.
- **Verifies**: recomputed `reverse(sha256d(raw))` equals the requested txid;
  mismatch is a hard failure.
- **Returns**: transaction evidence (raw bytes + parsed structure) with a
  `transaction` commitment (`type: sha-256d`, `native-id-type: txid`).

### `hb_store_lbry_claim_output`

- **Keys**: `<txid>:<nout>` outpoint.
- **Store opts**: `kind` ∈ `claim` (default) | `channel` | `stream` selects
  the evidence constructor; `walk-ancestry` (with `ancestry-depth-limit`)
  enables update-claim ancestry proofs. Store opts arrive JSON-decoded — a
  boolean may be the binary `<<"true">>`; handle both.
- **Fetches**: the containing raw transaction (as above); for ancestry, parent
  transactions recursively (one retry per parent fetch); for signed claims,
  the signing channel's own claim output located via `claim_search` on the
  reversed signing-channel hash — the channel key always comes from that raw
  evidence.
- **Verifies**: claim script parse; claim-ID derivation for creates; ancestry
  walk for updates when enabled, degrading honestly to `asserted` when
  evidence is unavailable; envelope decode; for `channel` kind, public-key
  extraction and normalization from the raw protobuf; for `stream` kind,
  `sd_hash` extraction (48 bytes) from the raw protobuf; channel-signature
  verification plus the binding check when attaching attestation.
- **Returns**: claim/channel/stream evidence with the corresponding outpoint
  commitment (`type` reflecting proof strength) and, for verified signed
  claims, an additional `attestation` commitment on the same message.

### `hb_store_lbry_stream_descriptor`

- **Keys**: 96-hex sd-hash (also reachable via the facade's namespaced path).
- **Fetches**: the descriptor blob from the blob CDN (layered over the blob
  store's fetch path).
- **Verifies**: `sha384(bytes)` equals the sd-hash; full structural parse —
  hex-field decode, ordered blob list, zero-length terminator, blob size
  rules, `stream_hash` recomputation. A blob that fetches but does not parse
  as a descriptor yields `{error, not_found}` so the stack falls through to
  the plain blob store for the same key.
- **Returns**: descriptor evidence (raw JSON + parsed blob table) with a
  `descriptor` commitment (`type: sha-384`, `native-id-type: sd-hash`).

### `hb_store_lbry_blob`

- **Keys**: bare 96-hex sha384; `lbry/blob/<96hex>`; `odysee/blob/<96hex>`.
- **Fetches**: `GET <base>/blob?hash=<96hex>` against the configured blob
  base (default `http://blobcache-eu.odycdn.com:5569`), with optional
  `edge-token` store opt appended as the `edge_token` query parameter.
- **Verifies**: `sha384(bytes)` equals the requested hash before any message
  is constructed.
- **Returns**: blob evidence (raw encrypted bytes) with a `blob` commitment
  (`type: sha-384`, `native-id-type: blob-hash`).

### `hb_store_odysee` — the facade

- **Keys**: the `odysee/` namespace — `odysee/claim-id/<40hex>`,
  `odysee/claim/<encoded lbry uri>`, `odysee/channel-id/<40hex>`,
  `odysee/outpoint/<txid>:<nout>`, `odysee/transaction/<64hex>`,
  `odysee/descriptor/<96hex>`, `odysee/blob/<96hex>` — plus bare-key
  classification: `txid:nout` → claim output, 96-hex → blob, 64-hex →
  transaction, 40-hex → claim ID.
- **Fetches**: for the *mutable* namespaces (`claim-id`, `claim`/URI,
  `channel-id`), a locator lookup via the SDK proxy (`resolve` /
  `claim_search`) to obtain the current outpoint; then delegation to the
  immutable stores above for all bytes. Immutable namespaces delegate
  directly. Path components lose the `//` of `lbry://` in normalization
  (`lbry:/`); the facade restores the scheme before resolving.
- **Verifies**: nothing itself beyond key classification — every returned
  message is constructed and committed by the delegated store, and the
  locator's claim-id hint is cross-checked against the derived claim ID
  (a mismatch is a failure, not a served message).
- **Returns**: whatever the delegated store returns; every surface leaving
  the facade carries native commitments. Mutable-namespace results are
  claim-id-current only as far as the locator is honest — the documented
  ClaimTrie gap ([lbry-data-model.md](lbry-data-model.md#known-gaps)).

Placement of these stores in a node's store stack, and how serving nodes
replicate their output without running them, is covered in
[node-operators.md](node-operators.md).
