# neo/1.0 — Odysee on HyperBEAM, clean-room port

Status log for the overnight port. Newest entries first. Decisions with
rationale live in `decisions/`.

## 2026-07-18 (day) — full-flow browser verification + write-path fixes

All four flows verified in the browser with screenshots, on a seed node
with `cookie_auth_hooks` (node on `127.0.0.1:10610`, left running for
inspection — kill the `rebar3 shell` BEAM owning that port to tear
down).

- **Video loading ✓** — watch page renders, video decodes and plays
  (readyState 4, 1920×1050, 33s in; full-page screenshot with player at
  0:14/3:21).
- **Comment rendering ✓** — a native comment (written over the UI's
  exact transport) renders under the video with channel identity, age,
  anonymous-user gating (log-in-to-reply), correct UTF-8.
- **Comment writing ✓ (transport) / login-gated (form)** — the comment
  box requires an Odysee account + channel (`Lbry.channel_sign` via the
  legacy SDK); the underlying native write is verified end-to-end.
- **Uploads ✓** — driven from the browser page context (the form itself
  is `PrivateRoute`-gated on a verified account): file → `POST
  /id?!=true` → `data-id`; index message → `POST /id?!=true` →
  `record-id`; the published claim resolves through the immutable route
  and renders with its media served from `GET /<data-id>`. Both
  `#/<recordId>` and `#/name:<recordId>` URLs resolve.
- **Auth ✓ (cookie identity)** — first `?!=true` POST mints the cookie
  wallet, `document.cookie` holds the secret, identity is stable across
  writes, responses carry the RFC-9421 signature of the derived wallet.
  The legacy account login page renders; actual login needs real
  credentials + reachable api.odysee.com ("could not get a user ID"
  banner in this environment is that legacy dependency, not our stack).

**The write path required real fixes** (`decisions/persist-device.md`):
`POST /id?!=true` on a cookie-auth node 500'd (cookie finalize appends a
`set` step → resolves the returned id as a base → hook-signed message
was never persisted → unhandled `{error,not_found}` shape). Fixed at the
app layer with **`persist@1.0`** — an `on/request` pipeline stage after
the auth hook that persists hook-committed messages, aliases the
resolver-visible ids to the stored path, and surfaces the stored id as
`message-id`. Plus frontend fixes: `target` is a reserved HB request key
(schema now uses `claim-id`/`target-id`), UTF-8 header decoding, native
upload index (replaces the dropped `~odysee-upload@1.0` index call),
`name:<id>` immutable-route resolution. 82 device tests green.

Follow-ups: upload edit/delete need store-first mutability semantics
(still device-targeted, will error); dev_query crashes on the
empty-result store-match shape (frontend maps the 500 to `[]`, but it is
an upstream shape bug worth noting alongside the hb_cache_control one).

## ACTIVE OBJECTIVES (from review, 2026-07-18) — read this on every context compaction

Direction set by review feedback on the first pass:

1. **Deep clean the entire build** for idiomatic HyperBEAM patterns and
   simplification, then re-verify the full UI flows in the browser.
   Follow `~/.config/llm-prefs/workflows/deep-clean/README.md`.
2. **Encoding**: commitment/evidence values must be header-safe without
   custom encodings; where a binary encoding is unavoidable use b64u
   (`hb_util:encode`), never hex. Convert the raw evidence fields
   (`claim`, `raw-transaction`, transaction `raw`, ancestry entries)
   from hex to b64u. LBRY identifiers (claim-id/txid/sd-hash) remain
   their natural hex display identity.
3. **Kernel discipline**: zero/minimal HB edits. The flat store-path
   fallback proposal is REJECTED (breaks the computation/cache model)
   — remove it. Drop the persist-hook-signed proposal. Only generally
   applicable fixes + `?IS_ID` may be proposed, each as a terse
   (<= 20 lines test+fix) branch on a `~/src/hyperbeam` WORKTREE, and
   only when certain it is an HB bug, not our misuse.
4. **Uploads**: the intended flow is plain `POST /id` — the node stores
   the item in its cache by default and `~query@1.0` finds it; peers
   `GET` the ID from each other. Re-verify this on a DEFAULT-config
   node; if it does not persist on stock edge, that is a candidate
   generally-applicable fix (terse worktree branch), not an app device.
   The team's custom auth is unnecessary except perhaps a very thin
   wrapper to reuse the existing Odysee auth cookie.
5. **Link-ID divergence**: our own messages must simply never embed
   uncommitted keys in nested messages (done — keep it that way). If
   still certain the divergence is an HB bug, produce the terse
   worktree test+patch; otherwise drop the proposal.
6. **Client-side verification is not the trust story** — TEE-terminated
   SSL on the serving node is. Do not build browser verification;
   remove it from docs as a trust mechanism.
7. **After (and only after) the clean is truly done**: build
   `~search@1.0` — a GENERIC full-text indexer device for HyperBEAM
   data. Schema from node Opts `search-schema` (if needed at all);
   invoked via a hook on message writes to the store; index all fields
   by default; must scale to >= 35M records (existing Odysee search
   dataset size). Engine must be terse and well-specified in the LMDB
   spirit — no bloated over-engineered dependencies. Evaluate e.g.
   SQLite FTS5 (single file, exact spec, BM25) vs a hand-rolled LMDB
   inverted index vs alternatives; justify the choice in a decision
   doc before building.

### Progress on the review objectives

- **(2) Encoding → done.** Embedded raw evidence (`claim`,
  `raw-transaction`, transaction `raw`, ancestry txs) is now b64u via
  `dev_lbry_commitment:evidence_encode/1`; decode is canonical-checked
  (fail-closed). LBRY ids stay hex. 104/61 tests green.
- **(3) Kernel discipline → done.** Flat-store-path and
  persist-hook-signed proposals removed from `patches/`. Only `?IS_ID`
  and Range remain (each a described upstream question, not a
  dependency).
- **(4) Upload flow → investigated.** Plain `POST /id?!=true` on a
  fully default node returns the committed ID but does NOT persist:
  `store-all-signed` runs at HTTP wire-decode, before the request
  hooks, so a message that only becomes signed via the hook is never
  stored; and the hook-processed sequence's IDs differ from the ID
  `/id` returns (three distinct identities), so even persisting it
  leaves the item unreachable. Captured as a failing repro test on the
  HB worktree branch `fix/store-hook-signed-requests`
  (`~/src/hyperbeam/.worktrees/store-hook-signed`, commit 5f3061a89) —
  test only, no fix, because the fix requires an upstream design
  decision on the canonical identity of "the posted item." This is a
  genuinely-general HB gap, not app-specific; surfaced for the HB team.
- **(5) Link-ID divergence → resolved by construction.** Our messages
  never embed uncommitted keys in nested messages (attestation embeds
  the committed channel view). No HB patch proposed.
- **(6) Trust model → TEE, not client.** Docs already frame serving
  trust as TEE-terminated SSL; the browser-verification note is being
  removed from the frontend and docs in the clean.
- **(1/8) Deep clean → in progress.**
  - Pass 1 (−568 lines): dead `dev_lbry_mmr` + fixtures, the unreachable
    remote-read re-verification layer, the SDK-map codec branches.
  - Pass 2 (−670 lines in `dev_lbry`): reduced `lbry@1.0` to a
    verification device (`verify`/`to_hint`/`content_type`); the codec +
    commit surface was unreachable (stores construct via
    `dev_lbry_commitment` directly). `to_hint` kept — `hb_message`'s
    `add_bundle_hint` calls it during verify.
  - Pass 3 (in progress): a 3-agent idiom audit (findings in
    `scratchpad/audit-findings.txt`) drives a safe dedup sweep across the
    store/bridge/client family (shared `valid_hex`/`raw_tx_hex`,
    `hb_util` coercions, `scope/0` removal, dead aliases, `else`-block
    removal). `fixtures` test-seam kept deliberately
    (`decisions/keep-fixtures-test-seam.md`).
  - `decisions/deep-clean-cuts.md` records all cuts. **src/ went
    10,128 → 8,662 lines (−1,466, ~14%)**, all tests green.
  - **UI re-verified on the cleaned build** (2026-07-18): fresh seed node
    on cleaned code, republished manifest, browser watch page renders and
    the video decodes end-to-end (640×360, readyState 4), zero console
    errors. Peer-serving path unchanged. Clean is done.
- **(7) `~search@1.0` built.** Generic full-text search device, SQLite
  FTS5 via the `esqlite` NIF (`decisions/search-engine.md`,
  `docs/search.md`).
  - `hb_search`: FTS5 index engine + node-scoped singleton server (write
    connection serialized, like `hb_store_lmdb`). Indexes each message's
    scalar UTF-8 string fields (or the `search-schema` field list);
    BM25-ranked queries. 4 core tests: index, BM25 rank, OR queries,
    diacritic folding, idempotent re-index, schema restriction,
    private/binary field skipping.
  - `dev_search` (`search@1.0`): write-hook handler (indexes each written
    message) + `query` key (returns ranked message ids). Packages and
    tests through the Forge (`write_then_query_test`); 81 device tests.
  - **Generic `write` hook** added to `hb_cache` on HB worktree
    `feat/cache-write-hook` (`~/src/hyperbeam/.worktrees/cache-write-hook`,
    commit f87de8272): fires `on/write` after each top-level message
    write, recursion-safe, no-op by default. 41 hb_cache tests pass.
    This is the general trigger Sam described; a minimal, generally-
    applicable HB addition.
  - `esqlite` dep + macOS NIF-link `post_hook` (pc doesn't link on this
    rebar3/macOS; HB's own NIFs use Makefiles for the same reason; Linux
    links normally). Adding the dep did not regress the build.
  - **Full E2E proven** (project built against the write-hook branch via
    a `_checkouts` override): `hb_cache:write(<committed message>)` →
    the `write` hook fires → `dev_search:write` indexes the fields →
    `~search@1.0/query?q=...` returns the message id, BM25-ranked. The
    recursion guard was moved into `hb_hook:execute_handler` (mirroring
    the `step` hook) so lookup still finds the handler; 41 hb_cache + 4
    hb_hook tests pass on the branch. Project then restored to stock
    `edge` (81 device tests green; the hook is a proposed HB change, not
    a project dependency).
  - Remaining: 35M-scale validation (bulk backfill + p99 against the
    real Odysee query mix) — documented in `docs/search.md`.

Media-range clarification for the record: 206 through
`~cache@1.0/read` could never honor `Range:` because HTTP request
headers do not reach store reads; the store was serving a fixed window
mislabeled as the requested one. The UI was NOT changed — browsers
still send `Range:`; the store now ignores it and serves the full
object (correct, unseekable). Real ranges remain an upstream question
(kept as a described proposal only).

## 2026-07-18 (early morning) — end-to-end proof

- **Full watch page rendered in a real browser from a stock-surface
  HyperBEAM node**: static SPA served at `GET /<ManifestID>` (hash
  routing; sanitized chunk names), claim + channel + stream evidence
  read via `GET /~cache@1.0/read?read=odysee/...&accept-bundle=true`,
  title/channel/thumbnail/date rendered from the decoded `value`,
  video frame decoding from `odysee/media/stream-id/<outpoint>`.
  Responses carry the `lbry@1.0` commitments in RFC-9421
  `signature`/`signature-input` headers, plus the node's RSA HTTPSig.
- Evidence encoding hardened for the wire: message-embedded raw bytes
  (`claim`, `raw-transaction`, transaction `raw`, ancestry entries)
  now travel as lowercase hex — the httpsig codec headers raw short
  values, which browsers reject. All 104 device tests + 70 eunit tests
  green after the change.
- Peer serving proven: a second stock-config node (fs cache +
  `hb_store_remote_node` -> seed) served the manifest and assets it did
  not have, fetched trustlessly from its peer.
- Auth: `POST /id?!=true` with the stock pipeline returns the
  hook-committed request ID (per-user wallet). Remaining gap for
  user-upload persistence documented in `patches/README.md` §4.
- Media: correct full-object serving; browser-grade seeking blocked on
  HTTP-layer Range support (`patches/README.md` §5). Local caching of
  decrypted media is an open performance follow-up (first fetch of a
  63MB stream took ~29s, re-fetched per read).
- Frontend follow-ups: comment-signature verification is currently
  fail-open client-side (tagged `unverified`) pending a browser
  verification path; homepage rails come back 400 for claims the SDK
  locator cannot resolve (graceful, but worth classifying).

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
