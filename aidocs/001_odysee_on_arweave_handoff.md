# Odysee on Arweave Handoff

Last updated: 2026-07-05

This document is the restart point for the Odysee-on-Arweave / Odysee-on-HyperBEAM work. It connects the meeting minutes, Slack decisions, current repository branches, and the dev server so the team can resume from the current state without replaying the full discussion history.

It has been updated after reading all meeting summaries, the 2026-06-16 transcript that has no summary, targeted transcript sections for commitments, `GET /<id>`, references, auth, uploads, range/chunking, and search, and a second pass over the 2026-06-29, 2026-07-01, and 2026-07-03 summaries and transcripts.

## Current objective

The current target is a small but end-to-end V1 demo:

- one deployable `master` branch;
- frontend and HyperBEAM running together;
- upload through the HyperBEAM path;
- playback/readback through store-native `GET /<id>` semantics;
- auth bridged through the existing Odysee cookie/token path for now;
- search through a HyperBEAM-facing search device backed by a self-hosted local index.

The target is not yet to replace all of `odysee.com`. The goal is to prove the bridge shape and keep moving toward decentralization without blocking on the final versions of wallet migration, full legacy search, channel references, transcoding, or global indexing.

The most important framing from the early meetings is that this is a read-side bridge first, not a bulk migration. Existing Odysee/LBRY data stays where it is initially. HyperBEAM becomes the verifiable read path that can pull existing data-at-rest into a shared message/store/codec model, after which nodes can cache, verify, and eventually replicate it. Once the read path is real, the write/upload path can tighten the loop by writing new content directly into HyperBEAM-native storage instead of publishing through legacy LBRY first and pulling it back out.

## Working mental model

The project has a "thin waist" target:

- stores answer requests for pre-existing IDs;
- codecs represent and verify source formats as HyperBEAM messages with commitments;
- devices perform computation only where generic stores/codecs/auth hooks are not enough;
- the UI should mostly ask for IDs and render returned data, not choose legacy versus HyperBEAM paths itself.

The preferred bridge path is:

1. A caller requests `GET /<id>`.
2. HyperBEAM recognizes the path as an ID.
3. The configured store stack tries local stores, remote stores, legacy Odysee/LBRY stores, and any other configured backing store.
4. The store returns a HyperBEAM message for the requested source object.
5. The message carries source-format commitments in the normal `commitments` structure.
6. Another node can verify the returned message through the relevant codec/device, cache it, and serve it later.

This is different from a proxy device that fetches legacy JSON and signs "I ran this request." Proxy attestations are useful demos, but the desired bridge result is source data with native commitments that HyperBEAM can verify and compose.

## What V1 is not

V1 should avoid presenting itself as a finished `odysee.com` replacement. It does not yet solve:

- final account/wallet migration;
- fully decentralized global search;
- complete channel/reference semantics;
- deterministic or TEE-backed transcoding;
- all private account state and API behavior;
- full legacy homepage parity;
- full historical import or a mass data rewrite.

It is acceptable for V1 to be a deployable demo that proves upload, auth bridge, search, and readback through the right architecture.

## Source repositories and locations

Local working repo:

- `/home/niko/work/repositories/odysee-on-arweave`

Meeting minutes repo:

- `/home/niko/work/minutes/new-odysee`

ASR cleanup glossary for live and saved transcripts:

- `/home/niko/work/minutes/aidocs/001_asr_company_glossary.md`
- Use this glossary when reading live Google Meet transcripts or normalizing saved ASR output. It contains project-specific corrections for terms like `Odysee`, `Arweave`, `HyperBEAM`, `Meilisearch`, `chainquery`, `GET /<id>`, and related device/code names.

Primary Slack context:

- `C0B7BN13U3H`
- Slack URL: `https://spaceodysee.slack.com/archives/C0B7BN13U3H`

## Meeting references

The summaries below are the most useful technical context. Each summary has a corresponding transcript in the same dated directory.

| Date | Summary | Why it matters |
| --- | --- | --- |
| 2026-06-02 | `/home/niko/work/minutes/new-odysee/2026-06-02/new-odysee-summary-2026-06-02.md` | Establishes the strategic direction: decentralize the data layer first, bridge existing Odysee data-at-rest through HyperBEAM, and avoid a naive petabyte-scale migration. |
| 2026-06-04 | `/home/niko/work/minutes/new-odysee/2026-06-04/new-odysee-summary-2026-06-04.md` | Deep source inventory: LBRY claims, channels, stream descriptors, blobs, comments, policy restrictions, codecs, and read-side bridge phases. |
| 2026-06-05 | `/home/niko/work/minutes/new-odysee/2026-06-05/new-odysee-summary-2026-06-05.md` | Clarifies stores/adapters versus codecs/devices and the clanker workflow for first source-format prototypes. |
| 2026-06-09 | `/home/niko/work/minutes/new-odysee/2026-06-09/new-odysee-summary-2026-06-09.md` | Shows first frontend/backend prototypes and identifies the auth-token/internal-API leakage problem. |
| 2026-06-10 | `/home/niko/work/minutes/new-odysee/2026-06-10/new-odysee-summary-2026-06-10.md` | Key commitment-layer review: move from proxy attestation to stores/codecs/messages with native source-format commitments. |
| 2026-06-12 | `/home/niko/work/minutes/new-odysee/2026-06-12/new-odysee-summary-2026-06-12.md` | Establishes that proof material in JSON bodies is the wrong layer and that claim/name resolution can be deferred for render-by-ID. |
| 2026-06-16 | `/home/niko/work/minutes/new-odysee/2026-06-16/meet-transcript-2026-06-16T14-01-29.txt` | Internal alignment transcript. Confirms commitment-header/body confusion, node A/node B verification expectations, and the need for a shared mental map before the next Sam review. |
| 2026-06-17 | `/home/niko/work/minutes/new-odysee/2026-06-17/new-odysee-summary-2026-06-17.md` | Established `GET /<id>`, immutable ID reads, source store versus index/query split, and txid/vout claim identity direction. |
| 2026-06-22 | `/home/niko/work/minutes/new-odysee/2026-06-22/new-odysee-summary-2026-06-22.md` | Captures the monorepo/shared-work direction after Niko was away. |
| 2026-06-23 | `/home/niko/work/minutes/new-odysee/2026-06-23/new-odysee-summary-2026-06-23.md` | Important for auth cookies, upload path, Odysee API scope, and discovery/query gaps. |
| 2026-06-26 | `/home/niko/work/minutes/new-odysee/2026-06-26/new-odysee-summary-2026-06-26.md` | Narrows toward generic store fallthrough, auth hook usage, and avoiding custom Odysee devices where HyperBEAM primitives are enough. |
| 2026-06-29 | `/home/niko/work/minutes/new-odysee/2026-06-29/new-odysee-summary-2026-06-29.md` | Main search/index/reference discussion. Defines the desired search shape: query in, ordered IDs/reference IDs out, stores resolve content. |
| 2026-07-01 | `/home/niko/work/minutes/new-odysee/2026-07-01/new-odysee-summary-2026-07-01.md` | Current convergence call. Assigns Rave/Raphael to search, Michael to deployment, Victor to auth, Bhavya to upload/store byte handling. |

## Slack decisions and updates

Slack messages from 2026-07-01 through 2026-07-03 add important implementation context after the meetings:

- Rave implemented search in `rave/auth-upload-search`, then merged the combined auth/upload/search/dev-console work into `master`.
- Rave reported that Meilisearch search works against both legacy and HyperBEAM results.
- Search weights are still bad because the current test uses limited chainquery slices. Rave saw old results for generic terms like `test` and said ranking should wait until a fuller index exists.
- Michael said the likely correct direction is an index living on the HyperBEAM node, not a permanent legacy search server that HyperBEAM calls out to.
- Niko said the search backend should be free/open-source, not a paid proprietary hosted service.
- Michael confirmed Meilisearch is MIT licensed and that the team would not use the hosted product.
- Rave asked whether to deploy Meilisearch on `15.204.119.211`. He estimated a full chainquery-backed index would require a few hundred GB.
- Niko recalled chainquery itself as around `1.5TB`.
- Michael reported that `main`/`master` deploys both HyperBEAM and frontend to:
  - `https://devhb1.zephyrdev.xyz/~meta@1.0/info`
  - `https://demo1.zephyrdev.xyz/`
- Bhavya said the whole upload flow and store were working as needed, but follow-up questions remained around duration metadata, edit flows, title changes, delete, and cleanup.
- Victor said auth landed on `victor/latest`, but he wanted another review pass before posting it more broadly.
- Rave flagged that current curated homepage objects contain channel claims, not media claims. The current system fetches latest claims from those channels, so replacing homepage data with immutable media IDs is not an exact behavioral match.

Useful Slack permalinks:

- Search working with Meilisearch: `https://spaceodysee.slack.com/archives/C0B7BN13U3H/p1782998496100459`
- Merge `rave/auth-upload-search` into master: `https://spaceodysee.slack.com/archives/C0B7BN13U3H/p1783009975477309`
- Meilisearch deployment question for `15.204.119.211`: `https://spaceodysee.slack.com/archives/C0B7BN13U3H/p1783075790897459`
- QUERY method discussion: `https://spaceodysee.slack.com/archives/C0B7BN13U3H/p1783076197896739`
- Homepage channel-claim issue: `https://spaceodysee.slack.com/archives/C0B7BN13U3H/p1782904170102189`

## Live merge-planning context from 2026-07-03

This section is intended for Claude/Fable/Codex agents doing the integration pass before the next Sam review.

Live Google Meet transcript access is available through the local `meet-transcript` MCP. The active transcript was also being saved under `/home/niko/.local/share/meet-bridge/transcripts`. Use `/home/niko/work/minutes/aidocs/001_asr_company_glossary.md` when reading live ASR output; for example, ASR often says "Miley Search" or "mail research" for `Meilisearch`, "Hyper Beam" for `HyperBEAM`, and "chain query" for `chainquery`.

Relevant live-call notes:

- Raphael/Rave got Meilisearch running on the demo server and indexing chainquery slices.
- Rave reported that search is now working on `demo1`, but filters were not working yet.
- The demo server now runs `master` at `443cfbc Adjust for deployment`.
- `443cfbc` includes the previously server-local account/proxy header stripping and `hyperbeam.ts` private-param preservation changes.
- The only remaining server-local repo diff observed after deployment was the frontend debug-console gating in `odysee-frontend/ui/component/app/view.tsx`.
- Victor said his auth branch covers legacy ECDSA/secp256k1 key migration via auth token, new wallet onboarding/login, browser-wallet auth, and multiple device/session style auth under one account/wallet.
- Victor also said Fable found multiple possible security issues in generated auth code. Treat those as unvalidated findings until another model or human review confirms them, but do not merge auth blindly before reviewing that area.
- Bhavya said his upload/store demo is mostly ready and close to what Sam wanted.
- Bhavya said his implementation is likely about 99% similar to Rave's, so expect overlap around auth/upload and avoid taking duplicate abstractions just because they exist on both branches.
- In the live call, Bhavya asked whether his store, immutable-ID, upload-by-`POST /<id>`, and read-by-`GET /<id>` pieces still need porting. Rave said those pieces appear to be in `master` already; the main possible difference may be user-state handling.
- Login/magic-link still was not confirmed working on `demo1` during the call. Niko had added the demo domain to the internal API allowlist, but the relevant deployment/GitHub job still appeared queued or slow.
- The short-term goal is to merge or cherry-pick the useful search/auth/upload pieces before the next Sam call.

## Claude/Fable merge brief

Start from current `origin/master` (`443cfbc Adjust for deployment`). Rave's search/deployment fixes are already there. The remaining integration work is mainly selective mining from Bhavya and Victor, not wholesale merging.

Recommended integration approach:

1. Create a temporary integration branch from `origin/master`.
2. Inspect `origin/bhavyagor/auth-upload` for upload/delete/cleanup/store behavior.
3. Inspect `origin/victor/latest` for auth/reference/secp256k1 behavior.
4. Port minimal, coherent pieces into the integration branch.
5. Keep the demo path working after each piece: auth, upload, readback, search, playback.
6. Avoid broad unrelated core rewrites unless the ported feature demonstrably needs them.
7. Validate any Fable-reported auth/security issues before merging auth code.
8. Do not rely on `aidocs/source-branches.md` as the source of truth; it is stale.

Pieces to mine from Bhavya's branch:

- latest commit `2b94819 update delete and cleanup of uploads`;
- upload delete and cleanup behavior;
- immutable-ID homepage/readback work only if still missing from `master`;
- store ID read alignment only if still missing from `master`;
- user-state handling if Bhavya's branch does something materially better or still missing in `master`;
- any upload UI fixes that are not already covered by Rave's merged work;
- comment sync pieces only if they are necessary for the demo and do not expand scope.

Bhavya branch risk: it changes many frontend and HyperBEAM files, including comments, sync, homepage, upload, user state, and core HyperBEAM resolver/store behavior. Expect overlap with current `master` and Rave's work. Prefer small cherry-picks or manual ports after reading the diff.

Pieces to mine from Victor's branch:

- `a039f66 Use secp256k1 for the migration demo act`;
- `bc6226a Fix ar_wallet secp256k1 JWK export to include public coordinates`;
- `c5f92e3 Add account-keyed Odysee auth: cookie-over-wire and owner-gated prefs`;
- `96c7dc6 Port odysee-reference@1.0 mutable claim->current layer`;
- `a38212d Port odysee-auth@1.0 cookie secret-provider and publish gate`;
- `18ec70d Port tx@1.0 ECDSA secp256k1 commit clause`;
- `f7df770 Use checked base64url decoder in hb_util:decode to fix commitment round-trip`;
- tests around Odysee auth/reference and tx ECDSA where they still apply.

Victor branch risk: it touches auth, reference semantics, transaction commitments, base64url decoding, and LBRY header/MMR support. These are high-value but security-sensitive. The auth-token/cookie bridge is acceptable only as a trusted Odysee-operated V1 bridge unless a TEE/secret-device design is explicit.

Expected conflict areas:

- `odysee-frontend/ui/util/hyperbeam.ts`;
- `odysee-frontend/ui/redux/actions/publish.ts`;
- `odysee-frontend/ui/component/publish/upload/uploadForm/view.tsx`;
- HyperBEAM auth hook/device files under `hyperbeam/src/preloaded/auth`;
- Odysee device files under `hyperbeam/src/preloaded/odysee`;
- `hb_util.erl` and transaction/commitment helpers.

Demo acceptance criteria for the integration branch:

- `demo1` can sign in or at least complete the intended auth bridge flow.
- Magic-link/login works after the demo domain/internal API allowlist deployment lands.
- Upload creates a retrievable HyperBEAM-backed object.
- The uploaded object plays back or reads back through `GET /<id>`.
- Search works through `~odysee-search@1.0` using local Meilisearch.
- Search filters either work or are clearly documented as the remaining blocker.
- No Meilisearch key, Odysee auth token, or cookie secret is exposed in request URLs, logs, or committed files.
- The debug console remains disabled by default on the public demo.

## Integration status from Codex pass on 2026-07-03

Local branch/worktree:

- Branch: `all-in-one`
- Base after fast-forward: `origin/master` at `9744bca Route magic-link email confirm through the account device`
- This is newer than the server state recorded below (`443cfbc`) and already includes several Victor/Rave pieces that the older merge brief lists as branch-mining targets.

Bhavya work ported into the local integration tree:

- Replaced `hyperbeam/src/preloaded/odysee/dev_odysee_upload.erl` with Bhavya's record/data-id upload model from `origin/bhavyagor/auth-upload`.
- This includes Bhavya's backend media range implementation: `Range` parsing, `206`, `416`, `Content-Range`, `Accept-Ranges`, `HEAD` handling, and the embedded range-response tests in `dev_odysee_upload.erl`.
- The same-origin web upload proxy in `odysee-frontend/web/src/routes.js` was not replaced with Bhavya's version because current `master` already has equivalent range behavior for the proxy path. Keep the current master implementation unless a concrete behavior gap appears.
- Added `~odysee-sync@1.0` and `~odysee-user-state@1.0` backend devices:
  - `hyperbeam/src/preloaded/odysee/dev_odysee_sync.erl`
  - `hyperbeam/src/preloaded/odysee/dev_odysee_user_state.erl`
- Added frontend services:
  - `odysee-frontend/ui/services/hyperbeamSync.ts`
  - `odysee-frontend/ui/services/hyperbeamUserState.ts`
- Updated HyperBEAM frontend device plumbing so `sync` and `userState` are enabled and `key&!` style request keys are encoded into JSON fields.
- Routed stateful SDK calls through `~odysee-user-state@1.0`: `preference_*`, `settings_*`, `sync_hash`, `sync_apply`, `channel_sign`, and collection create/list/update.
- Routed the relevant `Lbryio` membership methods through user-state when the user-state device is enabled; otherwise they remain on the original `Lbryio` path as a mode decision.
- Switched HyperBEAM upload publish/update/delete to Bhavya's generic-store write plus `~odysee-upload@1.0/index|update|delete&!` flow.
- Kept a compatibility `listHyperbeamPublishes` export and direct upload-list reads so current uploads pages and claim resolution continue to work.
- Added direct browser/server upload-list reads for `resolve`, `get`, and `claim_search` so HyperBEAM-native upload records are represented as an explicit source alongside indexed search results.
- Kept the newer master account/search mappings instead of taking Bhavya's older subscription/search assumptions.

Victor work handled in the local integration tree:

- Core auth/reference/secp256k1 work was already present in current `origin/master`; do not replace it wholesale with `origin/victor/latest`, because the branch copy is older in several files and would remove current tests/behavior.
- Restored Victor's runnable auth demo launcher:
  - `hyperbeam/scripts/odysee-auth-demo.sh`
- Restored Victor's auth demo HTML and auth explainer doc on disk:
  - `hyperbeam/priv/html/hyperbuddy@1.0/odysee-demo.html`
  - `aidocs/auth.md`
- `hyperbeam/priv/html/` and `aidocs/` are ignored in this checkout, so those restored files exist locally but will not appear in normal `git status` or be staged unless explicitly force-added.
- Addressed the review findings against commit `33aad6a5624a4fc77a7e5d1e6c5399872831c67b`:
  - `hb_lbry_mmr:verify_consistency/5` now binds old peaks to the configured snapshot size/shape instead of accepting any peak list with the same bagged root.
  - `lbry-header@1.0` now reads proof fields from `Req`, binds payload bytes such as chunk data, raw transaction bytes, and headers to `Base`, handles malformed inputs without crashing, and exposes/tests `mmr-block-inclusion` using the previously unused tx/header fixture.
  - Removed stale source/fixture references to missing `aidocs/003_*`, `aidocs/004_*`, and `aidocs/007_*` files, and clarified that `mmr-membership` `block-hash` values are internal-order MMR leaf hashes.

Verification run during the Codex pass:

- `rebar3 compile` from `hyperbeam/` passed.
- `rebar3 eunit --module=hb_lbry_mmr` from `hyperbeam/` passed.
- `rebar3 device test --devices dev_lbry_header --module dev_lbry_header` from `hyperbeam/` passed.
- `git diff --check` passed.
- `node --check odysee-frontend/web/src/odyseeHyperbeamNode.js` passed.
- Changed frontend files passed oxlint:
  - `extras/lbryinc/lbryio.ts`
  - `ui/lbry.ts`
  - `ui/redux/actions/publish.ts`
  - `ui/redux/actions/sync.ts`
  - `ui/redux/middleware/auth-token.ts`
  - `ui/services/hyperbeamUpload.ts`
  - `ui/services/hyperbeamSync.ts`
  - `ui/services/hyperbeamUserState.ts`
  - `ui/util/hyperbeam.ts`
  - `ui/util/hyperbeamDevices.ts`
  - `ui/util/hyperbeamMode.ts`
  - `web/src/odyseeHyperbeamNode.js`
- `pnpm run typecheck:tsc` gets past the merge changes but still fails on pre-existing missing Firebase module declarations in:
  - `web/src/push-notifications/index.ts`
  - `web/src/push-notifications/push-supported.ts`
  - `web/src/service-worker.ts`
- Full `pnpm run lint` is blocked by pre-existing repo-wide warnings and existing `web/src/routes.js` errors; the changed files themselves pass the targeted lint command.
- `rebar3 eunit --module=dev_odysee_upload` cannot target preloaded Forge-packaged modules because they are not ordinary app modules in this rebar setup. Treat `rebar3 compile` plus the preload packaging as the backend syntax/package verification done so far.

Remaining review risks after this pass:

- Bhavya's upload device does not reintroduce Rave's Meilisearch indexing hooks from the prior upload device. Search currently composes the existing `~odysee-search@1.0` indexed results with direct upload-list reads for HyperBEAM-native uploads, but native upload indexing into Meilisearch should be reviewed before deployment.
- The direct `GET /<id>` media/read path needs a live node smoke test after deploying this branch.
- The user-state device is now wired into frontend SDK calls, but logged-in state flows need browser testing with a real token.
- Victor's demo files are restored locally; decide whether to force-add ignored demo/docs or keep them as local handoff artifacts.

## Second-pass alignment check on 2026-07-05

This check re-read the three newest meeting artifacts under `/home/niko/work/minutes/new-odysee`:

- `2026-06-29`
- `2026-07-01`
- `2026-07-03`

The current `all-in-one` integration is directionally aligned with those meetings:

- Bhavya's range implementation is present in `dev_odysee_upload.erl`, including `Range`, `206`, `416`, `Content-Range`, `Accept-Ranges`, and `HEAD` behavior.
- New publish writes bytes to the generic HyperBEAM store first through `POST /id?!=true`, then uses `~odysee-upload@1.0/index|update|delete&!` for Odysee-specific metadata/listing/edit/delete behavior.
- HyperBEAM-native upload records expose media URLs as direct `/<id>` paths, and the frontend/server lookup path composes upload-list records with `resolve`, `get`, and `claim_search` instead of sending intended HyperBEAM playback through `player.odycdn.com`.
- Search remains a pragmatic V1 path: HyperBEAM-facing search over local Meilisearch plus direct upload-list reads for native uploads. This matches the meeting target of a minimal query path, not final decentralized global search.
- Auth/user-state is still an Odysee-operated bridge, not the final account model. The longer-term direction remains `secret@1.0` for secrets/auth factors and `reference@1.0` for mutable account/channel/claim state.

Remaining alignment gaps or watch points:

- Legacy immutable readback still needs a live smoke test: given a legacy immutable `txid:vout` or equivalent store ID, `GET /<id>` should return renderable content without a UI branch that chooses Odycdn/player playback.
- `~odysee-upload@1.0` should stay scoped to Odysee-specific metadata/list/update/delete behavior. It should not become the core content retrieval mechanism for bytes that are already stored under generic immutable IDs.
- Token-bearing signed uploads use the Odysee auth token as the stable owner identity. Tokenless signed requests use the request signer as a distinct supported mode, not as an implicit backup path.
- The uploaded object's on-disk/store shape with large media plus metadata still needs inspection before optimizing the final large-file format.
- Native upload records may still need explicit Meilisearch indexing, or the team should accept direct upload-list reads as the designed native-upload source for the next demo.

## Current architecture decisions

### Stores, codecs, devices, and commitments

The team should keep the HyperBEAM responsibility boundaries clear:

- a store sources data for an ID;
- a codec converts and verifies a source format;
- a device performs higher-level computation or transformation;
- the message `commitments` field is where source-format proof/commitment metadata belongs.

The repeated Sam feedback from 2026-06-10, 2026-06-12, and 2026-06-16 was that returning proof fields inside JSON bodies is not enough. That shape hides the commitments from normal HyperBEAM machinery. Correct returned messages should have a `commitments` map whose commitment message names the relevant commitment/codec device, so normal encoding can expose `Signature` / `Signature-Input` and other commitment metadata in the expected way.

When in doubt, prefer normal HyperBEAM store/auth behavior over a new Odysee-specific device. Custom devices are fine when there is real Odysee-specific computation, but every unnecessary custom route makes the eventual decentralized node story worse.

### Search

The interim search decision is pragmatic and self-hosted:

- use a local/self-hosted index, currently Meilisearch;
- expose it through HyperBEAM as `~odysee-search@1.0`;
- support basic text/filter search first;
- return IDs or reference-like results that can be resolved through normal content paths;
- do not treat Meilisearch or Elasticsearch as the final decentralized search design;
- do not rely on a permanent legacy search callout as the target architecture.

The long-term shape remains decentralized-compatible: a HyperBEAM node should be able to index messages entering its stores/caches, use configured schemas, and answer queries with IDs. Full global decentralized search is still open.

The conceptual API from the meetings is simple: query in, ordered IDs or references out, stores resolve the data. Legacy Odysee search is actually multiple systems: wallet-server filtering over chain data, Elasticsearch full-text search, and recommendations. V1 does not need to reproduce all of that.

For a more general HyperBEAM search/indexer, the desired design is schema driven:

- a write hook sees messages as they enter a store/cache;
- node configuration declares schemas or message/tag filters;
- matching messages are indexed into one or more indexes;
- query calls choose an index/schema and return IDs.

### Reads and identity

Reads should continue moving toward store-native `GET /<id>`.

Legacy claim IDs are mutable references, not immutable content IDs. The more precise immutable identity for legacy content is transaction ID plus output index (`txid:vout`). Claim IDs and names should eventually resolve through a reference/query layer before the store fetches immutable data.

For the prototype, curated immutable IDs are acceptable to exercise store-native rendering, but they do not fully replace current homepage semantics because homepage entries are often channel claims.

Important nuance:

- claim updates are atomic replacements of the full claim value, not field-level patches;
- a claim ID is derived from the original create transaction/output and remains stable across updates;
- the latest claim state is an index/reference question;
- a store should not receive one ID and silently return a different immutable ID without a reference layer or trusted lookup table;
- `reference@1.0` is the likely HyperBEAM-native way to model claim-like mutable identity.

For old Odysee data, the low-level path should prove "given this immutable transaction/output, can we load and verify it?" Name lookup, channel membership, latest-state resolution, homepage lists, and search belong above that in query/reference/index layers.

### Uploads

New uploads should avoid legacy 2 MB LBRY blob structure unless compatibility requires it. Larger whole objects are acceptable if range requests and store behavior work.

The upload path Sam kept pushing toward is generic HyperBEAM write behavior:

- post bytes through a normal HyperBEAM route such as `POST /<id>?...!`;
- let the configured auth/on-request hook sign with the node/user auth structure;
- write the resulting message into configured stores;
- return or derive an ID;
- fetch it back later with `GET /<id>`.

The unresolved implementation detail is the canonical stored object:

- raw media bytes;
- HTTP SIG message containing media and metadata;
- committed HyperBEAM message with metadata in commitments/headers and media in the body;
- another HyperBEAM-native representation.

Bhavya's next concrete check is to inspect what lands on disk/in the store for large uploads with metadata and to remove accidental legacy claim fields unless intentionally required.

Range requests remain required for practical video playback and seeking. Bhavya's backend upload-device range implementation is present in the local integration tree, and the current master same-origin web upload proxy already serves range requests for the proxy path. For V1, it is acceptable for nodes to verify whole objects or stored source data while serving byte ranges to users. The final large-media structure is still open; ideas discussed include whole files with range reads, larger chunks, Arweave transaction-style chunk trees, and eventually chunk-addressable sharing. Do not preserve the old 2 MB LBRY blob format for new uploads unless there is a concrete compatibility reason.

### Auth

V1 should not block on full wallet migration or deterministic Arweave wallet derivation.

The short-term auth path is an Odysee auth bridge:

- existing `auth_token`/cookie proves access to the existing account/wallet;
- HyperBEAM uses the configured auth path to sign or gate writes;
- the team learns what cookie auth can and cannot support before committing to the final migration UX.

Victor's branch contains the main active auth/reference/secp256k1 work, but it should be ported selectively rather than merged wholesale.

Auth tokens are sensitive. Early prototypes that proxied internal API traffic through HyperBEAM proved feasibility, but they are not safe as a decentralized pattern because node operators could read or log cookies/tokens. HyperBEAM has private `priv*` fields and cookie/wallet-management machinery that may help, but V1 should treat the cookie/token path as a trusted Odysee-operated bridge unless and until the TEE/secret-device design is explicit.

The longer-term auth model remains open. Possible pieces include imported legacy ECDSA keys, native Arweave/Wander-style wallets, secret-device commitments with multiple auth factors, and TEE-backed nodes that can prove they run the right policy before receiving secrets.

### Content restrictions

The bridge must not accidentally re-enable restricted content. Existing Odysee paths apply geoblocking, DMCA, domain-protection, and other policy checks. If the bridge starts accessing blobs directly instead of through existing player/blob-serving paths, it needs an explicit policy layer or signed blocklist model before public serving.

This is not just a product concern. It is part of whether the demo can safely be exposed beyond trusted internal testing.

### Transcoding

Transcoded renditions are not solved by the current bridge. Original-source verification can follow LBRY claims, stream descriptors, and encrypted blob hashes. Transcoded outputs are lossy derivatives currently produced by centralized Odysee infrastructure and do not have the same source-format proof chain.

Possible future directions discussed:

- serve original source first and treat transcoded output as an optional cache/perk;
- trust Odysee's transcoder key by default and allow other trusted keys;
- use TEE-backed transcoding;
- investigate Livepeer-like validation/slashing approaches;
- explore deterministic CPU transcoding, though verification cost may be high.

Do not let transcoding block the V1 store-native read/upload/search/auth demo.

## Repository branch state

Observed locally on 2026-07-03:

- `master` tracks `origin/master`.
- `origin/master` is at `443cfbc Adjust for deployment`.
- `origin/master` includes `Auth, upload & search (#2)`, `Update search`, and `Adjust for deployment`.
- `aidocs/source-branches.md` is stale. It still describes the June 29 branch state and should not be used as the current source of truth.

Relevant branches:

| Branch | Status | Notes |
| --- | --- | --- |
| `origin/master` | Current base | Use this as the integration base. Contains current search device, frontend search wiring, chainquery-to-Meilisearch import script, and deployment adjustments for account proxy headers / private auth params. |
| `origin/rave/auth-upload-search` | Superseded | Its work appears merged/squashed into `master`, then `master` added more search updates. Do not base new work on it. |
| `origin/rave/auth-upload` | Superseded | Older Rave auth/upload branch. |
| `origin/bhavyagor/auth-upload` | Divergent upload/store branch | Tip `2b94819 update delete and cleanup of uploads`. Contains potentially useful upload/delete/cleanup work, immutable-ID homepage/readback work, and store ID alignment. It changes many files and should be mined selectively. |
| `origin/victor/latest` | Divergent auth/reference work | Tip `a039f66 Use secp256k1 for the migration demo act`. Contains important auth/reference/secp256k1 migration work. Port selectively; do not merge wholesale into `master`. |
| `origin/michael/hyperbeam-auth-experiments` | Older experiment | Useful as historical context only. |
| `origin/michael/hyperbeam-livestream-p2p-poc` | Separate P2P livestream POC | Out of scope for current upload/search/auth convergence. |
| `origin/codex/hyperbeam-auth-experiments` | Older experiment | Useful as historical demo context only. |
| `origin/bhavyagor/odysee-bridge-devices` | Older baseline | Superseded. |

Files to inspect for current search:

- `hyperbeam/src/preloaded/odysee/dev_odysee_search.erl`
- `odysee-frontend/ui/redux/actions/search.ts`
- `odysee-frontend/ui/util/hyperbeam.ts`
- `scripts/import-chainquery-meili.mjs`

## Server reference

Server:

- SSH: `odysee@15.204.119.211`
- Hostname: `odysee-arweave-dev`
- OS: Ubuntu 24.04.4 LTS
- RAM: 22 GiB
- Disk: one root disk, 193 GB total, about 170 GB free when inspected
- Docker: installed/running, with a `meilisearch` container active when rechecked
- Passwordless sudo: available for user `odysee`

Running services:

- `odysee-main-hyperbeam.service`
- `odysee-main-frontend.service`
- `odysee-main-refresh.service`
- `caddy.service`
- `devhb-status.service`
- `netdata.service`

Current service paths and ports:

| Service | Path | Port / URL |
| --- | --- | --- |
| HyperBEAM | `/home/odysee/odysee-on-arweave/hyperbeam` | local `8734`, public `https://devhb1.zephyrdev.xyz/` |
| Frontend | `/home/odysee/odysee-on-arweave/odysee-frontend` | local `9090`, public `https://demo1.zephyrdev.xyz/` |
| Status page | `/home/odysee/devhb-status` | local `9085`, public `https://devhb.zephyrdev.xyz/` |
| Meilisearch | `/home/odysee/meilisearch/data` | local `127.0.0.1:7700`, Docker container `meilisearch` |

Public endpoint check on 2026-07-03:

- `https://devhb1.zephyrdev.xyz/~meta@1.0/info` returns HTTP 200.
- `https://demo1.zephyrdev.xyz/` returns HTTP 200.
- `https://devhb.zephyrdev.xyz/` returns HTTP 200.

Current server repo state:

- `/home/odysee/odysee-on-arweave`
- Branch: `master`
- Commit: `443cfbc Adjust for deployment`
- The checkout currently has one local diff:
  - `odysee-frontend/ui/component/app/view.tsx` disables the HyperBEAM debug console unless `ENABLE_HYPERBEAM_DEBUG_CONSOLE=true`.
- `/home/odysee/bin/odysee-main-update.sh` reapplies the frontend debug-console hardening after a forced reset.
- The account/proxy header-stripping and `hyperbeam.ts` private-param preservation changes are now in `master` via `443cfbc`.

Deployment behavior:

- `/etc/systemd/system/odysee-main-refresh.service` runs `/home/odysee/bin/odysee-main-update.sh --force --no-restart`.
- The update script force-checks out/reset `master` from origin.
- It then reapplies frontend debug-console hardening.
- It runs frontend install/build and `rebar3 compile`.
- If not called with `--no-restart`, it restarts the HyperBEAM and frontend services.

Meilisearch state on 2026-07-03:

- `meilisearch` is running as Docker container `meilisearch` from `getmeili/meilisearch:v1.15`.
- The container is bound to `127.0.0.1:7700` and has restart policy `unless-stopped`.
- Data is bind-mounted at `/home/odysee/meilisearch/data`.
- The data directory was about `178M` when checked.
- `curl http://127.0.0.1:7700/health` returns `{"status":"available"}`.
- The `odysee_claims` index exists with about `5,051` documents.
- Meilisearch is running with a master key. Do not write the key into this document.
- `~odysee-search@1.0/status` now returns healthy Meilisearch stats without passing the key in the request URL.
- Search was reported working on `demo1`; filters were reported not working yet in the live 2026-07-03 call.

Server conclusion:

This box now has a limited/test Meilisearch deployment with a small chainquery-derived index. It is still not large enough for a full "few hundred GB" index unless storage is attached or the root disk is expanded. Basic HyperBEAM-to-Meilisearch wiring is healthy; filter behavior is the current reported search gap.

## Suggested next steps

1. Treat local branch `all-in-one` as the current Bhavya/Victor integration branch under review.
2. Re-run backend compile/tests and targeted frontend checks after any further conflict fixes.
3. Deploy or stage `all-in-one` on a demo node and smoke-test new upload, direct `GET /<id>` readback, byte-range playback, edit, delete, and logged-in user-state flows.
4. Smoke-test legacy immutable readback through the same store-native path using a legacy `txid:vout` or equivalent immutable store ID.
5. Re-test `~odysee-search@1.0/status`, a basic search query through HyperBEAM, frontend search on `demo1`, and search filters.
6. Decide whether native upload records must also write into Rave's Meilisearch native-upload index path, or whether direct upload-list reads are the designed source for the next demo.
7. Keep Meilisearch data under `/home/odysee/meilisearch/data` or a future attached volume, not inside the repo checkout.
8. Import a larger bounded chainquery slice using `scripts/import-chainquery-meili.mjs` only after auth and search filters are stable.
9. Keep ranking work shallow until the index contains a representative corpus.
10. Decide whether Victor's ignored auth demo HTML/doc should be force-added, moved to a non-ignored path, or left as local handoff material.
11. Avoid wholesale merges from divergent experiment branches.
12. Revisit the homepage model because current curated homepage entries are channel claims, not media claims.
13. Clarify the canonical stored-object format for new uploads before optimizing large-file behavior.

## Open questions

- Where should the full search index live if it exceeds this server's free disk?
- Should the first Meilisearch deployment index only native uploads, a limited legacy slice, or a broader chainquery import?
- Should Meilisearch be considered a node-local index backend or a shared temporary service for all demo nodes?
- What is the exact API contract for `~odysee-search@1.0`: claim IDs, immutable IDs, reference IDs, or mixed records?
- How should search results handle mutable claim IDs while the UI still expects legacy claim data?
- Why are search filters not working on `demo1` even though basic search works?
- How do channel-claim homepage entries map into the immutable-ID prototype without losing current homepage behavior?
- Should Bhavya's upload records also write into Rave's Meilisearch native-upload index path, or should direct upload-list reads remain the designed source for native uploads in the next demo?
- Should Victor's ignored auth demo HTML/doc be force-added, moved to a non-ignored path, or left as local handoff material?
- Does the server need additional storage before any full legacy search import?
- Should the frontend debug-console hardening patch be committed upstream instead of reapplied locally by the deploy script?
- Which Fable-reported auth/security findings are real and need fixes before Victor's auth pieces land?

## Practical restart checklist

Use this checklist when resuming work:

1. Pull latest `origin/master` locally.
2. Confirm the server is still on `443cfbc` or later.
3. Check `demo1.zephyrdev.xyz` and `devhb1.zephyrdev.xyz`.
4. Confirm the `meilisearch` container is still running and bound only to `127.0.0.1:7700`.
5. Confirm `/home/odysee/hb_configs/hb1-rave.json` has the expected search backend/key configuration.
6. Exercise `~odysee-search@1.0/status` without passing the key in the request URL.
7. Exercise a basic HyperBEAM search query.
8. Exercise frontend search and filters.
9. Compare search behavior against the current Odysee search enough to identify obvious ranking/schema gaps.
10. Port only targeted pieces from Bhavya/Victor branches.
11. Validate the resulting auth/upload/search/readback path before the Sam call.
