# The verifiable LBRY data model

Byte-precise specification of every LBRY structure the system verifies, and of
the commitment representation that carries the proofs. This is the normative
reference for the `lbry@1.0` device and for browser-side re-verification.
System context: [architecture.md](architecture.md); where the bytes come from:
[data-sourcing.md](data-sourcing.md).

Conventions: `sha256d(X)` = `sha256(sha256(X))`. "Internal order" is the
natural output byte order of a hash; "display order" is its byte-reversed
form, shown as lowercase hex (Bitcoin convention). `hash160(X)` =
`ripemd160(sha256(X))`. All integer field widths are given explicitly.

## Transactions

LBRY transactions are Bitcoin-style: version, input list (each
`prev_tx_hash:32` internal order, `prev_nout:32/little`, scriptSig, sequence),
output list (each `amount:64/little`, scriptPubKey), locktime; var-int list
lengths and script lengths.

```
txid_internal = sha256d(raw_tx)                 %% 32 bytes, internal order
txid_display  = hex(reverse(txid_internal))     %% 64 lowercase hex chars
```

A transaction fetched by txid is accepted only if the locally recomputed
display txid equals the requested key.

## Claim scripts

LBRY extends output scripts with claim prefixes ahead of a standard P2PKH
payment tail (`76 a9 14 <hash160(pubkey)> 88 ac`):

- **Create** (`OP_CLAIM_NAME` = `0xb5`):
  `b5 <push name> <push claim_bytes> OP_2DROP(6d) OP_DROP(75) <payment-script>`
- **Update** (`OP_UPDATE_CLAIM` = `0xb7`):
  `b7 <push name> <push claim_hash:20> <push claim_bytes> OP_2DROP OP_2DROP <payment-script>`
  where `claim_hash` is the 20-byte claim hash in internal (reversed) order.

### claim_id

A claim ID is 20 bytes, displayed as 40 lowercase hex chars.

- **Create outputs — hash-derived:**

  ```
  claim_hash       = hash160( txid_internal(32) || nout:32/big )
  claim_id_display = hex(reverse(claim_hash))
  ```

  where `txid_internal` is `sha256d(raw_tx)` of the *containing* transaction
  and `nout` is the output index. Anyone holding the raw transaction derives
  the claim ID; the SDK cannot forge it.

- **Update outputs — asserted:** the 20-byte claim hash is a script literal.
  The output only *claims* to update that ID; on its own it proves nothing.

### Update ancestry: upgrading asserted to ancestor-derived

An update's claim ID becomes proven by walking the spend chain back to the
`OP_CLAIM_NAME` create that hash-derives it. Per hop, verify the spending
input's P2PKH signature:

- scriptSig must be exactly `<push (DER_sig || 0x01)> <push pubkey>`
  (SIGHASH_ALL only), and `hash160(pubkey)` must equal the parent payment
  script's recipient hash.
- Signature digest is the legacy Bitcoin SIGHASH_ALL digest with
  **scriptCode = the parent output's FULL scriptPubKey, claim prefix
  included** (LBRY hashes the entire executing script, unlike scriptCode
  narrowing in some Bitcoin descendants).
- Candidate uniqueness: every input's parent transaction must be present in
  the proof material, and exactly one input of each child may spend an output
  carrying the claim ID. Cycles rejected; walk depth limited (default 128).

Proof construction degrades gracefully — missing or unsupported evidence
yields an honest `asserted` label — but proof *verification* fails closed.

This gives three **proof strengths**, recorded on claim evidence as
`claim-proof-strength`: `hash-derived` (create), `ancestor-derived` (update
with verified ancestry), `asserted` (update without). Where a stream proof
combines with a channel proof, the combined strength is the weaker of the two.

## Claim value envelopes

The pushed `claim_bytes` decode by first byte:

- `<<0, Protobuf/binary>>` — v2 protobuf, unsigned.
- `<<1, SigningChannelHash:20/binary, Signature:64/binary, Protobuf/binary>>`
  — v2 protobuf, **signed**. `SigningChannelHash` is the signing channel's
  claim hash in internal (reversed) order; `Signature` is a compact secp256k1
  signature, `r || s`, 32+32 bytes.
- `<<"{", ...>>` — v0 legacy JSON. Anything else — v1 legacy protobuf.
  Neither legacy form is decoded (see [Known gaps](#known-gaps)).

## Channel signatures

The digest a channel signs over a v2 claim:

```
digest = sha256(
    first_input.prev_tx_hash(32, internal order)
 || first_input.prev_nout:32/little
 || signing_channel_hash(20)
 || claim_protobuf_bytes
)
```

where `first_input` is the first input of the transaction *containing the
signed claim*, and `claim_protobuf_bytes` is the protobuf body from the
envelope (after the 85-byte signed-envelope header).

Verification, ECDSA over secp256k1 with SHA-256:

- Signature is the envelope's 64-byte compact `<<R:256, S:256>>`; require
  `0 < R, S < N`. High-S values are accepted (both `S` and `N − S` verify on
  chain; do not enforce low-S). Convert to DER for the underlying crypto call.
- The channel public key is taken **from the raw channel claim's protobuf**
  (`Channel.public_key`, path below) — never from SDK JSON. On-chain
  encodings: 33-byte compressed (`02`/`03`), 65-byte uncompressed (`04`), or
  DER/SPKI-wrapped secp256k1. Normalize to 33-byte compressed; reject foreign
  curve OIDs, off-curve points, and non-canonical field elements
  (`X` or `Y >= p`).
- **Binding check**: the envelope's `signing_channel_hash` must equal
  `reverse(channel_claim_id_bytes)` of the channel evidence used for the key.
  Without this, a valid signature from the *wrong* channel would pass.

Unsigned claims fail closed on any path that promises channel attribution.

## Protobuf field paths

Claim protobufs are read with a minimal varint/wire-type walker; only these
paths are consumed:

- `Claim.stream` = field 1; `Claim.channel` = field 2 (oneof).
- `Stream.source` = field 1 (within stream); `Source.sd_hash` = field 6,
  exactly 48 bytes (SHA-384).
- `Channel.public_key` = field 1 (within channel).

## The stream layer

A stream claim's `sd_hash` is the SHA-384 of the **stream descriptor blob**, a
JSON document. Descriptor fields (string fields hex-encoded):

- `stream_type` — `"lbryfile"`.
- `stream_name`, `suggested_file_name` — hex-encoded names.
- `key` — hex of the 16-byte AES-128 content key.
- `stream_hash` — 48-byte stream hash (structural; recomputed as
  `sha384(stream_name_hex || key_hex || suggested_file_name_hex || sha384(concatenated blob hashsums))`).
- `blobs` — ordered list of `{blob_num, length, iv, blob_hash}` where `iv` is
  hex of 16 bytes, `length` is the **encrypted** byte length, and
  `blob_hash` is hex of `sha384(encrypted_blob_bytes)` — followed by a final
  zero-length terminator entry carrying no `blob_hash`.

Size rules: every non-final data blob is exactly **2,097,152** encrypted
bytes; the final data blob is ≤ 2,097,152 and 16-byte aligned. The plaintext
stride is **2,097,151** bytes per blob (one PKCS7 pad byte minimum consumes
the difference).

Decryption: per blob, AES-128-CBC with the descriptor `key` and the blob's
`iv`, then PKCS7 unpad; concatenate plaintexts in `blob_num` order.

Byte-range mapping: plaintext offset `O` lives in blob
`N = O div 2097151` at intra-blob offset `O rem 2097151`; a range fetch
decrypts only the covered blob window. Exact stream size =
`2097151 × (num_data_blobs − 1) + plaintext_size(last_blob)` — computable by
fetching only the final blob.

Verification order for a stream: descriptor bytes hash to `sd_hash`; the
descriptor parses structurally (terminator present, size rules hold); each
fetched data blob hashes to its `blob_hash` **before** decryption is
attempted.

## The commitment representation

Evidence messages are plain `message@1.0` maps; all proofs live in their
`commitments` map with `commitment-device => <<"lbry@1.0">>`. Commitments are
content-addressed: no wallet, no committer.

### Commitment message fields

| key | value |
|---|---|
| `commitment-device` | `<<"lbry@1.0">>` |
| `evidence` | kind: `claim` \| `channel` \| `stream` \| `descriptor` \| `blob` \| `transaction` \| `attestation` |
| `type` | proof recipe (table below) |
| `signature` | base64url (unpadded) of the native-ID bytes; for `attestation`, of the 64-byte compact channel signature |
| `committed` | numbered map of committed keys, in TABM wire form |
| `native-id` | the native identifier in display hex |
| `native-id-type` | `outpoint` \| `txid` \| `sd-hash` \| `blob-hash` |
| kind extras | e.g. `claim-op`, `claim-proof-strength` (claim family); `channel-id`, `public-key` (channel); `sd-hash` (stream) |

### Native-ID bytes and commitment IDs

```
outpoint  = decode_hex(txid_display)(32, display order) || nout:32/big   %% 36 bytes
txid      = decode_hex(txid_display)                                     %% 32 bytes
sd-hash   = decode_hex(sd_hash_hex)                                      %% 48 bytes
blob-hash = decode_hex(blob_hash_hex)                                    %% 48 bytes
```

The commitment's key in the `commitments` map (its commitment ID) is the
base64url human ID of the native-ID bytes, **sha256-folded when not already
32 bytes**:

```
commitment_id = base64url(NativeID)            when byte_size(NativeID) == 32
              = base64url(sha256(NativeID))    otherwise   %% outpoint 36 B, sd/blob 48 B,
                                                           %% attestation signature 64 B
```

Because a message with commitments derives its ID by accumulating its
commitment IDs, an evidence message's AO-Core ID is a pure function of its
native LBRY identity — content addressing composes upward.

### Proof-recipe types

| `type` | evidence kinds | verify recomputes |
|---|---|---|
| `sha-256d` | transaction | display txid from raw bytes |
| `sha-384` | descriptor, blob | sha384 of raw bytes (+ structural parse for descriptors) |
| `hash160-outpoint` | claim, channel, stream | claim ID by the create derivation |
| `ancestor-hash160-outpoint` | claim, channel, stream | ancestry walk to a hash-derived create |
| `asserted-claim-id` | claim, channel, stream | script re-parse only; ID remains asserted |
| `secp256k1-sha256` | attestation | the channel-signature check, including key normalization and the binding check |

### Anti-forgery rules

Verification enforces four structural rules beyond the byte recipes:

1. **Committed-key allowlists.** Each evidence kind has a fixed allowlist of
   keys its commitment may cover. A commitment claiming coverage of a foreign
   key fails verification — a node cannot smuggle an unverified key under a
   valid commitment.
2. **Co-evidence vouching.** Derived keys such as `sd-hash` (from the claim
   protobuf) or nested channel evidence are accepted only when the commitment
   that *derives* them is present on the same message and replays
   successfully. A bare `sd-hash` key with no deriving stream commitment is
   uncommitted data.
3. **Shared committed lists.** Sibling commitments on one message commit the
   union of the message's committed keys. Committed-key queries intersect
   across selected commitments, so without sharing, cache narrowing
   (`with_only_committed`) would silently strip keys bound by only one
   sibling.
4. **Canonical committed-list rebuild on transport.** The httpsig wire
   encoding cannot express body-subset commitments, so committed lists are
   rebuilt canonically when messages cross a remote read; verifiers must work
   from the decoded message plus the transported commitment fields, not raw
   wire bytes.

Verifiers select these commitments explicitly:
`hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, Opts)` —
default and committer-based selections skip committer-less commitments
entirely (see [architecture.md](architecture.md#trust-model)).

## Known gaps

- **No ClaimTrie currentness proof.** Name → claim resolution, and
  claim-id → *current* outpoint, are trusted-locator concerns: the SDK could
  serve a stale or losing claim for a name. Everything at and below the
  outpoint is verified; which outpoint is "the" current one is not.
- **No block inclusion / SPV by default.** A verified transaction is
  internally consistent but not proven to be on the LBRY chain. An optional
  stronger tier exists: MMR commitments over block headers (peak bagging by
  right-to-left sha256d, membership and consistency proofs, 1024-header chunk
  subtree roots, Electrum-style transaction-merkle folds) against a trust
  root pinned in node options. Not required by the default trust model.
- **v0/v1 claim envelopes undecoded.** Legacy JSON and pre-v2 protobuf claims
  are recognized and labeled but not parsed; their metadata is unavailable on
  the trustless path.
