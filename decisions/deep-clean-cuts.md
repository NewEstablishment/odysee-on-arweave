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

## Why not more

Store behaviour callbacks flagged by xref as unused exports are dynamic
dispatch (`hb_store` calls by atom) — kept. Convenience `/2` heads on
the commitment constructors are the documented API and used by tests —
kept.
