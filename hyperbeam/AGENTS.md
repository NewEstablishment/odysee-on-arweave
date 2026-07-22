# HyperBEAM Component Guide

This directory is the runtime and storage side of the Odysee-on-HyperBEAM system. Keep generic HyperBEAM primitives reusable and isolate Odysee protocol translation in Odysee devices and stores.

HyperBEAM implements AO-Core. Read `README.md`, `CONTRIBUTING.md`, and `docs/misc/hacking-on-hyperbeam.md` before changing core behavior.

## Engineering Rules

1. Keep edits surgical and preserve the existing feature set.
2. Search for existing helpers before adding utilities, especially in `hb_ao`, `hb_util`, and `hb_test_utils`.
3. Distinguish Erlang maps from AO-Core messages. Messages may be lazy-loaded or linkified and do not always have ordinary map semantics.
4. Run focused tests and the broadest practical regression suite before presenting work as complete. Production behavior, not a toy implementation, is required.
5. Leave the code more precise, clear, and minimal than you found it.

## Architectural Laws

1. Immutable reads are ID-first. A store read for an immutable ID must return that exact object, never silently translate it to an unrelated current object.
2. A legacy LBRY claim output is identified by `txid:nout`. A 40-byte claim ID is mutable and reference-like, not the immutable content ID.
3. `query@1.0` and `search@1.0` are upstream generic devices. Do not add Odysee grouping, ranking, pagination, moderation, or compatibility behavior to them.
4. Product adapters may translate legacy APIs and data formats, but browser code must not bypass HyperBEAM to call those services directly.
5. Private auth material is request input only. Strip tokens and cookies before public messages are signed or persisted.
6. Search and query return IDs or paths. Hydration happens through generic ID/store reads.

## Store And Identity Model

The default store stack in `src/core/resolver/hb_opts.erl` starts with the primary local store and filesystem cache, then uses `hb_store_odysee`, Arweave, and gateway stores. `hb_store_odysee` is a read-only compatibility source. It normalizes legacy claims, transactions, claim outputs, descriptors, comments, and blobs into HyperBEAM-readable messages and commits verifiable source evidence where the legacy format supports it.

Important identities:

- Native HyperBEAM object: its immutable message ID.
- Legacy claim output: `<txid>:<nout>`, canonicalized to `odysee/claim-output/<txid>/<nout>`.
- Legacy blob: SHA-384 blob hash.
- Legacy claim ID: compatibility/reference key for the latest claim state.
- Name: mutable lookup input that eventually belongs above the immutable store in a reference layer.

On-demand legacy reads are preferred over copying all legacy media into the local store. Once sourced, normal cache/store behavior may persist the normalized immutable representation.

## Generic Devices

### `query@1.0`

`src/preloaded/query/dev_query.erl` performs exact matching against messages in supported stores. `only` selects exact keys; `return` supports paths, counts, messages, first matches, and booleans. Product integrations should normally request paths and hydrate each returned ID separately.

Native comments use one target-wide exact query, then perform deduplication, revision selection, reply grouping, counts, sorting, moderation projection, historical merging, and pagination outside the generic device.

### `search@1.0`

`src/preloaded/query/dev_search.erl` is generic full-text discovery for HyperBEAM messages. Its write hook accepts an ID plus a message, its schema comes from node/base configuration, and queries retrieve IDs only. It uses `hb_search` and remains backend-agnostic at the device boundary.

## LBRY Devices

The LBRY devices are source-format codecs and commitment verifiers. They are not product API adapters. Odysee devices and stores use them to turn legacy chain, claim, descriptor, and blob evidence into independently verifiable HyperBEAM messages.

- `lbry@1.0` (`src/preloaded/codec/dev_lbry.erl`): umbrella verifier and hint dispatcher for blob, descriptor, transaction, claim, channel, stream, and attestation evidence.
- `lbry-blob@1.0` (`src/preloaded/codec/dev_lbry_blob.erl`): encodes, decodes, and verifies encrypted blob bytes against their native SHA-384 ID.
- `lbry-stream-descriptor@1.0` (`src/preloaded/codec/dev_lbry_stream_descriptor.erl`): encodes, decodes, and verifies raw stream descriptor JSON against its `sd_hash` and derived stream metadata.
- `lbry-transaction@1.0` (`src/preloaded/codec/dev_lbry_transaction.erl`): encodes, decodes, and verifies raw LBRY transaction bytes against the display-order transaction ID.
- `lbry-claim@1.0` (`src/preloaded/codec/dev_lbry_claim.erl`): encodes, decodes, and verifies a generic protobuf claim extracted from a specific transaction output.
- `lbry-channel@1.0` (`src/preloaded/codec/dev_lbry_channel.erl`): specializes verified claim output data as a channel and preserves the channel public key needed by downstream signature checks.
- `lbry-stream@1.0` (`src/preloaded/codec/dev_lbry_stream.erl`): specializes verified claim output data as a stream and commits its source descriptor reference.
- `lbry-channel-attestation@1.0` (`src/preloaded/codec/dev_lbry_channel_attestation.erl`): verifies the channel signature binding a stream claim, signing channel, and source descriptor hash.
- `lbry-claim-output@1.0` (`src/preloaded/odysee/dev_lbry_claim_output.erl`): commits and verifies the normalized result of a raw transaction-output proof. It is the bridge from `odysee-claim-proof@1.0` into the LBRY-native claim commitment family.
- `lbry-header@1.0` (`src/preloaded/codec/dev_lbry_header.erl`): verifies header chunks, MMR membership proofs, and MMR consistency proofs against the root pinned in node options. TEE-tail and MMR-genesis attestations are not implemented here.

The common codec operations are `from`, `to`, `to-hint`, and `verify`. `lbry-claim-output@1.0` exposes `commit`, `verify`, and `to-hint`; `lbry-header@1.0` is verification-only. The supporting source stores are `hb_store_lbry_blob`, `hb_store_lbry_stream_descriptor`, `hb_store_lbry_transaction`, and `hb_store_lbry_claim_output`. `hb_store_odysee` composes these source boundaries for compatibility reads instead of inventing a second playback or claim format.

## Odysee Devices

- `odysee-account@1.0`: account preference/settings operations, account identity and email flows, account status, and the public subscription-count surface.
- `odysee-channel@1.0`: channel normalization from a URI or claim, including the public key used by downstream LBRY signature verification.
- `odysee-claim@1.0`: mutable URI/claim lookup, claim-search compatibility, and raw transaction sourcing.
- `odysee-claim-proof@1.0`: raw transaction-output decoding and verification before conversion to an LBRY-native claim-output commitment.
- `odysee-comment@1.0`: Commentron compatibility, normalization, and channel-signature verification. Historical comments and legacy control/settings operations stay behind this device.
- `odysee-file@1.0`: normalized file view-count compatibility reads.
- `odysee-file-reaction@1.0`: normalized file-reaction compatibility reads.
- `odysee-reaction@1.0`: normalized historical comment-reaction compatibility reads.
- `owned-reference@1.0`: owner-gated mutable pointers above immutable objects.
- `odysee-reference@1.0`: operator-gated compatibility references above immutable objects.
- `odysee-policy@1.0`: signed policy evaluation and enforcement for delivery/playback decisions.
- `odysee-stream@1.0`: stream normalization, playback, verified-stream construction, and ranged media resolution, including immutable claim-output input.
- `odysee-stream-descriptor@1.0`: descriptor fetch/decode/verification, reconstruction, and media-range orchestration over LBRY stores.
- `odysee-upload@1.0`: authenticated chunked uploads, manifests, ownership, indexing, listing, reconciliation, updates, deletes, and native media records.
- `odysee-auth@1.0`: request secret provider used by `auth-hook@1.0`; it maps sessions to account authority and strips credential carriers before persistence.
- `odysee-publish-gate@1.0`: request hook that rejects protected publish paths without an auth credential.

`odysee-subscription@1.0` remains an internal compatibility implementation used by `odysee-account@1.0`; the frontend-facing route is the account device.

The removed `odysee@1.0` catch-all SDK proxy must not be recreated. New product behavior belongs in a narrow device with an explicit contract. See the root `README.md` for every public operation and the end-to-end request flows.

## Search

Fuzzy Odysee claim search uses the unchanged generic `search@1.0` device directly. Legacy Chainquery rows and native upload records are normalized and submitted through `search@1.0/write` into the configured `hyperbeam_messages` index. Documents carry searchable, filterable, and ranking fields plus an immutable `id`; `search@1.0/query` returns only ordered immutable IDs for callers to hydrate through stores.

Do not add Odysee-specific operations to `search@1.0`. Product request mapping and result hydration belong at the frontend integration boundary, while index settings are node deployment configuration. Odysee upload indexing invokes only the public generic `write` operation.

Meilisearch is an index, not the source of truth. Chainquery remains the legacy corpus source, and native HyperBEAM messages remain authoritative for native records. Index writes, deletes, and reconciliation must not mutate source objects.

## Native Comments And Controls

New comments are signed structured messages written through the generic ID path. Stable selectors include `type=comment`, `target`, `parent`, `state`, `author`, and `schema=odysee-comment@1.0`.

Edits are append-only revisions. The root immutable ID is the logical comment ID; each revision has its own physical ID and links with `revision-of`, `previous-version`, and a monotonically increasing revision number. The integration accepts only a contiguous, same-owner, signature-valid chain.

Owner controls are append-only `odysee-comment-control@1.0` messages. Visibility, pin, creator heart, and creator-channel block state are derived from the latest valid authorized event. The original comment is never mutated. Legacy Commentron controls are compatibility data; owner-authenticated legacy block rows may be lazily promoted to signed native controls once the owner signs in.

## Auth And Trusted Writes

The normal request hook runs `auth-hook@1.0`. Odysee browser auth reaches `dev_odysee_auth`, which derives request authority and strips token fields before persistence. Local development uses the frontend same-origin bridge because an Odysee cookie cannot be sent directly to `127.0.0.1`; same-origin production can route cookie-authenticated requests directly.

Thumbnail bytes are written through native `cache@1.0/write`, not an Odysee-specific cache device. The frontend proxy signs with `HYPERBEAM_CACHE_WRITER_JWK`; the resulting address must be in the node's `cache_writers`. The signature uses RSA-PSS/SHA-512, a body `content-digest`, HyperBEAM's derived-component convention, and a `comm-` label.

## Static Manifest Support

The frontend can be published as an Arweave path manifest through generic signed HyperBEAM writes. This is optional and does not replace the normal SSR deployment or its authenticated bridges.

## Local Operation

```sh
HOME=/tmp/odysee-hb-home rebar3 as hyperbeam compile
HOME=/tmp/odysee-hb-home HB_PORT=18785 rebar3 device local
```

Start the local device shell with a TTY. Do not narrow the device set for normal development. Verify the listener and metadata route before testing the frontend.

Typical focused validation:

```sh
HOME=/tmp/odysee-hb-home rebar3 as hyperbeam compile
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_claim
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_comment
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_stream
HOME=/tmp/odysee-hb-home HB_PORT=0 rebar3 device test -d dev_odysee_upload
```

The two-node source/cache demo remains available at `scripts/odysee-two-node-demo.sh`.

## Current State And Limitations

- The Neo integration established the unified LBRY commitment and store-first legacy source path while retaining richer master-side auth, comments, uploads, search, playback, and diagnostics.
- Browser-selectable legacy wiring has been removed. Legacy systems are backend sources behind devices/stores only.
- Generic `query@1.0` and `search@1.0` remain upstream-style reusable primitives.
- Odysee fuzzy search still depends on Meilisearch and a populated legacy/native index.
- Historical comments and several account/moderation operations still require Commentron through `odysee-comment@1.0`.
- Full mutable-name/claim migration to owned references is not complete.
- A real TEE deployment requires an AMD SEV-SNP Linux host and the hb-os stack; ordinary local development is not a TEE.

Update this file whenever these contracts, device ownership boundaries, run commands, or limitations change.
