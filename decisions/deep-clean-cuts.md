# Decision: first deep-clean reduction pass

## Original prompt (as understood)

Re-assess the entire build for idiomatic HyperBEAM patterns and
simplification; deep clean intensely while keeping the full UI flows
working. Client-side verification is not the trust story — TEE-terminated
serving is.

## Cuts

1. **`dev_lbry_mmr` (296 lines) + its fixtures.** Pure MMR math with no
   production caller: the header-evidence tier that consumed it
   (`dev_lbry_header` upstream) was deliberately not ported, so the
   module is groundwork for a product surface that does not exist here.
   Re-import together with the header/SPV tier if and when that tier is
   built.
2. **The remote-read view layer in `dev_lbry_commitment`**
   (`verify_remote_read/3`, `expected_remote_commitment/1`,
   `canonical_committed_keys`, `native_committed_view`,
   `narrow_channel_evidence`, `with_links`) and
   `test/hb_lbry_remote_read_test.erl`. It existed to re-verify
   LBRY-shaped keys read from untrusted peer nodes, but nothing can
   invoke it: stock `hb_store_remote_node` has no verification hooks
   (the vendored tree modified the kernel for this, which is off the
   table), and the review set the serving-path trust story as
   TEE-terminated SSL rather than per-hop re-verification. The
   commitment model's own anti-forgery machinery (committed-key
   allowlists, co-evidence vouching, shared committed lists) is
   untouched — it guards verification itself, not remote reads.
3. **The SDK-map codec branches in `dev_lbry`**
   (`from/3` over channel/stream SDK-shaped maps,
   `normalize_channel/1`, `normalize_stream/1,2`). The codec's product
   role is wire-format ingestion of raw source objects (claim
   envelopes, descriptors, transactions, blobs); nothing converts SDK
   JSON through the device codec — stores build evidence from raw
   transactions only. The branches were inherited shape-compatibility
   from the vendored eight-device world.
4. `dev_lbry_ancestry:verify_spend/3` un-exported (internal only).

## Second pass (audit-driven)

5. **`dev_lbry` reduced to a verification device** (921 → ~290 lines).
   The codec + commit surface (`from/3`, `to/3`, `commit/3` and their
   `commit_*`/`from_*`/`to_*`/`raw`/`hex_to_binary` helpers) was
   unreachable: nothing calls `hb_message:convert`/`commit` on
   `lbry@1.0`; stores build evidence through `dev_lbry_commitment`'s
   constructors directly, and the only dispatched entrypoint is
   `verify/3`. Per the milestone-1 brief ("verify ... commit is less
   important"), the device is now a pure verifier: `verify/3`,
   `to_hint/3`, `content_type/1`. The per-kind `dev_lbry` verify tests
   were redundant with `dev_lbry_commitment`'s 18 dispatch tests (which
   exercise `hb_message:verify` → `dev_lbry:verify` end-to-end for every
   kind); replaced with one compact dispatch/fail-closed test, and the
   ~110 lines of duplicated real-crypto fixtures deleted with them.

   **Gotcha the audit missed:** `to_hint/3` is NOT dead. `hb_message`'s
   `add_bundle_hint` calls it on the commitment device while converting
   a message to TABM for verification, so removing it broke every
   nested-structure verify (claim/stream/attestation). Kept.

## Why not more

Store behaviour callbacks flagged by xref as unused exports are dynamic
dispatch (`hb_store` calls by atom) — kept. Convenience `/2` heads on
the commitment constructors are the documented API and used by tests —
kept.
