# neo/1.0 — Odysee on HyperBEAM, clean-room port

Status log for the overnight port. Newest entries first. Decisions with
rationale live in `decisions/`.

## 2026-07-17 (evening)

- Devices/stores ported and green: single `lbry@1.0` commitment+codec
  device + crypto helper modules + five read-only stores. 104 tests via
  `rebar3 device test`, plus the store/codec/corpus/remote-read eunit
  suites (`HB_PRELOADED_STORE=$PWD/_build/device-test-store` unlocks
  eunit after a device-test run).
- Live E2E against real mainnet Odysee: a seed node
  (`hb_odysee_node:start_seed/1`) serves
  `GET /~cache@1.0/read?read=odysee/claim-id/<id>` with full attested
  evidence (claim + sd-hash + secp256k1 channel attestation), verified
  fail-closed and narrowed before leaving the store.
- Found+fixed: edge's `hb_link:normalize` links nested children by
  full-content ID while `hb_cache:write` registers committed-view IDs —
  divergent for committer-less commitments (dangling links, HTTP 500s).
  Route-around: attestation embeds channel evidence as its committed
  view. Upstream proposal in `patches/README.md` §3.
- UI: static SPA build published into a node's store as a path manifest
  (`hb_odysee_ui:publish/2`); `GET /<ManifestID>` serves the app.
  A second, stock-config node with only `hb_store_remote_node` pointed
  at the seed serves the same UI trustlessly (manifest + assets 200).
- Frontend data layer rewritten store-first: all `~odysee-*@1.0` device
  calls and Koa proxies removed from read paths; reads go through
  `/~cache@1.0/read?read=odysee/...`; tsc/build/native-comment tests
  green.
- Deep links: manifest index-fallback covers only the first missing
  path segment, so manifest-served mode uses hash routing; `~` (and
  other path-syntax characters) in built chunk filenames 500 on nodes —
  build sanitizes them. (In progress at time of writing.)
- Auth: `POST /id?!=true` with the stock pipeline signs the request
  with a hook-derived user wallet and returns the committed ID.
  Persistence gap for hook-signed uploads documented as
  `patches/README.md` §4 (store-all-signed runs pre-hook; cache_writers
  is static).

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
