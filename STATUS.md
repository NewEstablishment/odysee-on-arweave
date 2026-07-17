# neo/1.0 — Odysee on HyperBEAM, clean-room port

Status log for the overnight port. Newest entries first. Decisions with
rationale live in `decisions/`.

## 2026-07-17

- Familiarization complete: core resolver (`hb_ao`), base device
  (`dev_message`), commitment contract (`dev_ans104` as exemplar), store
  behaviour (`hb_store`), Forge packaging (`hb_packager`/`hb_device_load`),
  plus 14 deep-read briefs over every relevant subsystem and all prior
  Odysee branches (archived outside the repo; summarized in `docs/`).
- Sitrep highlights:
  - `rave/moderation` is fully merged into master; the only unmerged work
    is `bhavya/watchpage-changes` (composed watch-page GET surface) and
    `victor/reduce-safe-devices` (deletes an unreferenced gate device).
  - The vendored `hyperbeam/` tree on master is the newest superset of all
    device/store work. Its crown jewels are the LBRY crypto libraries
    (`hb_lbry_tx`, `hb_lbry_attestation`, `hb_lbry_claim_proto`,
    `hb_lbry_stream_descriptor`, `hb_lbry_ancestry`, `hb_lbry_commitment`):
    real secp256k1 claim-signature verification, hash-derived claim IDs,
    ancestry proofs for updates, sd-hash/blob/txid content addressing.
  - The ~14 `~odysee-*@1.0` app devices are legacy-API bridges the
    clean-room drops; reads become store reads, writes become
    `~auth-hook@1.0`-signed generic messages (the native-comment pattern
    that rave/moderation already proved).
- Milestone 1-2 done: orphan branch `neo/1.0`, Forge device project
  skeleton (`rebar3 new device name=odysee`) at the repo root.
- HyperBEAM `edge` dependency building in the background.

## Plan of record

1. ~~Clean-room branch + rebar3 device skeleton~~ (done)
2. `docs/`: architecture + data sourcing (in progress)
3. Port devices/stores: single `lbry@1.0` commitment+codec device
   (`dev_lbry.erl` + helper modules), read-only stores
   (`hb_store_odysee`, `hb_store_lbry_{blob,transaction,claim_output,
   stream_descriptor}`), test corpus.
4. UI: static SPA served from a HyperBEAM node by manifest ID; video page
   backed by native `GET /ID` store reads with HTTPSig-verifiable
   responses.
5. Authenticated writes via default `~auth-hook@1.0` (`?!=true` commit
   flag), uploads as signed cache messages discoverable via `~query@1.0`.
