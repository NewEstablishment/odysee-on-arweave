# Decision: one `lbry@1.0` commitment device, not a device family

## Original prompt (as understood)

"Lbry codec and commitment devices: Devices that implement the commitment
specification from `~message@1.0`, letting us verify all of the
cryptographically verifiable data types that Odysee makes use of. ... The
idea is also to minimize the number of custom devices that would be
necessary."

## Issue

The prior work ships eight commitment/codec devices (`lbry-claim@1.0`,
`lbry-channel@1.0`, `lbry-stream@1.0`, `lbry-blob@1.0`,
`lbry-transaction@1.0`, `lbry-stream-descriptor@1.0`,
`lbry-channel-attestation@1.0`, `lbry-header@1.0`), each a thin wrapper
over one shared library (`hb_lbry_commitment`). Every one of them must be
individually pinned in `trusted-devices` (or signer-trusted) by every
node operator who wants to serve Odysee data.

## Options

1. Port the eight-device family as-is.
   - Pro: byte-compatible with the existing demo corpus; per-kind
     `device` keys on evidence messages.
   - Con: eight `trusted-devices` entries; eight Forge packages; the
     `device` key on evidence messages adds no behaviour (all data keys
     resolve via the default accessor anyway).
2. Single `lbry@1.0` codec+commitment device; commitment kind dispatched
   on the commitment's `native-id-type` + `type` fields, evidence
   messages carry no `device` key (plain `message@1.0` data).
   - Pro: one `trusted-devices` entry; one archive to verify/load;
     directly serves the stated goal of minimizing custom devices;
     evidence messages resolve `GET /ID/key` through the base device
     with zero custom code.
   - Con: no per-kind `content_type`; verify dispatch is internal rather
     than by device name; breaks byte-compatibility with the existing
     demo corpus (acceptable: clean room, no backwards compatibility by
     default).

## Decision

Option 2. All commitments carry `commitment-device => <<"lbry@1.0">>`
plus an explicit `evidence` field (`claim`, `channel`, `stream`,
`descriptor`, `blob`, `transaction`, `attestation`) that selects the
verification recipe; `native-id-type` and `type` retain their vendored
meanings. A forged `evidence` value can only select a recipe that then
fails, since every recipe re-derives all facts from the committed raw
bytes. `dev_message`'s `commitment-device`
dispatch reaches one module; multiple commitments of different kinds
coexist on one evidence message under a single device name, which also
sidesteps `dev_message:id_device/2`'s multiple-device error path
entirely.

The crypto libraries port essentially verbatim as package helper modules
(`dev_lbry_tx`, `dev_lbry_attestation`, `dev_lbry_claim_proto`,
`dev_lbry_stream_descriptor`, `dev_lbry_ancestry`,
`dev_lbry_commitment`), so the separation of concerns survives; only the
public device surface collapses.
