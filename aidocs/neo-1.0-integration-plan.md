# Neo 1.0 Integration Plan

## Objective

Integrate the useful implementation work from `neo/1.0` into `master`
without replacing or regressing the product behavior already present on
`master`.

`neo/1.0` is an unrelated-history, clean-room implementation. It is an
implementation source and architectural reference, not a branch that can be
merged wholesale. The July 20 meeting transcript is context only. It supplies
constraints and acceptance criteria, especially around immutable IDs, store
behavior, and ID-only search results; it does not define the integration
scope. The task is the selective integration of `neo/1.0` into the current
`master` product.

## Non-Negotiable Constraints

- Keep `master` as the functional baseline throughout the integration.
- Do not use `git merge --allow-unrelated-histories` or copy the neo tree over
  master.
- Introduce replacements alongside existing behavior, migrate callers in
  bounded steps, and remove old paths only after parity is proven.
- A store read for an immutable ID must return the object addressed by that
  exact ID and must verify the object's native commitment before accepting it.
- Legacy names and claim IDs are compatibility inputs. They resolve to an
  immutable transaction/output ID above the immutable store boundary.
- Preserve mixed legacy and native behavior for playback, channels, uploads,
  updates, deletes, accounts, settings, comments, moderation, subscriptions,
  thumbnails, and search.
- Keep Meilisearch and the existing Chainquery import path. Neo's SQLite FTS5
  work is a prototype and is not a replacement for the current search engine.
- Search infrastructure returns immutable IDs. Product objects are hydrated
  from stores after search.
- Do not bulk-copy the legacy media corpus. Legacy media remains an on-demand,
  verify, cache, and serve flow.

## Branch Adoption Matrix

### Port And Adapt

| Neo work | Master integration |
| --- | --- |
| Unified `lbry@1.0` verification device | Add alongside the existing per-kind LBRY devices. Convert one producer at a time and retain compatibility verification until all consumers are proven. |
| `dev_lbry_commitment` evidence dispatch | Adapt into the existing `hb_lbry_commitment` library with explicit evidence kinds and canonical b64u evidence bytes. Preserve existing constructors while adding the unified commitment shape. |
| Cleaned LBRY crypto/parser helpers | Compare function by function with current `hb_lbry_*` modules and port only bug fixes, fail-closed validation, canonical encoding, and safe reductions. Keep master-only APIs still used by product paths. |
| Direct HTTP source stores | Remove the store-to-application-device layering inversion. Source stores may call legacy HTTP endpoints and construct verified evidence directly, but must preserve master response fields and failure behavior. |
| Store-first cache warming | Reuse the exact ID returned by verified construction, write it to the local store, and make later reads resolve locally. Avoid aliases that imply unverified mutable-to-immutable equivalence. |
| Generic signed writes | Route native writes through stock HyperBEAM signing, persistence, and ID behavior where master has equivalent ownership and security semantics. Keep thin application adapters where product authorization or lifecycle behavior is still required. |
| Generic `query@1.0` discovery | Keep the upstream query device and master fixes. Native application messages should be discoverable by exact signed fields and hydrated by returned ID. |
| Static manifest serving | Add subpath/hash-routing and manifest publishing support as an additional deployment mode. Do not replace the current SSR and dynamic application server. |
| Neo cleanup reductions | Apply only after usage analysis and focused tests. Dynamic behavior callbacks and compatibility APIs are not dead merely because static analysis cannot see their callers. |

## Component-Level Disposition

The following mapping is the frozen implementation contract for the port. It
is based on neo's authored commits and final tree, not on the unrelated-history
branch diff.

| Neo component | Master destination | Disposition |
| --- | --- | --- |
| `dev_lbry` | `hyperbeam/src/preloaded/codec/dev_lbry.erl` | Adopt the single `lbry@1.0` verification surface. Dispatch to the proven master verification recipes rather than duplicating them. |
| `dev_lbry_commitment` | `hyperbeam/src/core/lib/hb_lbry_commitment.erl` | Adapt canonical evidence encoding and unified commitment conversion. Keep all current constructors, remote verification, derived SDK fields, and per-kind compatibility. |
| `dev_lbry_ancestry`, `dev_lbry_attestation`, `dev_lbry_claim_proto`, `dev_lbry_stream_descriptor`, `dev_lbry_tx` | Existing `hb_lbry_*` modules | Retain master implementations. Port only concrete fail-closed fixes; do not replace master-only APIs and events. |
| `hb_store_odysee` and LBRY kind stores | Existing `hyperbeam/src/core/store/` modules | Adapt direct source reads and verified warming incrementally. Keep current range, proxy, remote verification, SDK surface, and product adjunct routes. |
| `hb_odysee_client`, `hb_odysee_bridge` | `hb_lbry_proxy`, `hb_lbry_bridge` | Retain master modules and fold in only missing narrow source helpers. Do not create a second HTTP client stack. |
| `dev_reply_id` | Existing generic signed POST/cache behavior | Superseded unless a focused response-ID test proves a remaining gap. |
| `dev_search`, `hb_search` | `hyperbeam/src/preloaded/query/dev_search.erl`, `hyperbeam/src/core/search/hb_search.erl`, `dev_odysee_search`, Meilisearch | Adapt the generic schema, write-hook, and ID-only query contract. Reject Neo's SQLite FTS5 backend and implement the generic contract over the existing Meilisearch deployment. Keep `odysee-search@1.0` as the product adapter. |
| `hb_odysee_ui`, static manifest frontend changes | Existing frontend and SSR server | Adopt as an optional build/serving mode. Normal SSR remains the default and must keep identical product behavior. |
| Neo frontend SDK reductions | Existing `odysee-frontend/ui` SDK facade | Do not copy wholesale. Port only manifest support and independently proven immutable-ID/store fixes. |
| Neo native upload/comment prototypes | Existing master upload, comment, moderation, and query flows | Superseded. Use only for request/response contract comparisons. |
| `hb_odysee_node` | Existing `hb_opts` store/auth configuration and `hyperbeam/scripts/odysee-two-node-demo.sh` | Superseded. Do not add a parallel node bootstrap. |
| `hb_odysee_util` | Existing `hb_lbry_*`, store, and bridge helpers | Superseded as a module. Port only concrete validation and normalization fixes into their current owners. |
| `hb_store_lbry_blob`, `hb_store_lbry_claim_output`, `hb_store_lbry_stream_descriptor`, `hb_store_lbry_transaction` | Existing kind stores under `hyperbeam/src/core/store/` | Retain the richer master stores and add unified commitment verification at the shared commitment boundary. |
| `odysee.app.src` | Existing HyperBEAM application/device registration | Do not import the Neo application skeleton. Register only the adopted devices through the current Forge/preloaded layout. |

### Unified Commitment Compatibility Rule

The unified form is additive at first:

- Every unified commitment uses `commitment-device = lbry@1.0` and an explicit
  evidence kind.
- Existing message-level `device` fields remain during migration because the
  current SDK and product surfaces use them to distinguish blobs,
  transactions, claims, channels, and streams. A single commitment device does
  not require deleting that product metadata.
- Raw transaction, claim protobuf, and ancestry transaction bytes use
  canonical unpadded b64u in unified messages. Blob data remains raw bytes and
  descriptor handling follows its existing structured codec contract.
- Existing per-kind commitment messages remain readable and verifiable. No
  producer changes format until the unified verifier, remote-store
  classification, wire round-trip, and dual-format test corpus pass.
- Remote reads must validate both the native identifier and the allowed
  evidence kind for that identifier shape. Merely seeing `lbry@1.0` is not
  sufficient.

### Validation Record

Completed on `master` at `a6190f9850fa67eeddc16222f7713ef500147bee`
with `neo/1.0` at `696b903c54399bf48282908e24948d667d3b6260`:

- Full HyperBEAM compile passed with the existing native compiler compatibility
  flag: `CFLAGS=-Wno-error=incompatible-function-pointer-types`.
- Focused device suites passed: `lbry@1.0` 8/8, `query@1.0` 11/11,
  generic `search@1.0` 3/3, `odysee-search@1.0` 10/10, and
  `odysee-upload@1.0` 24/24 (56/56 total). The focused packaged-device
  command uses `rebar3 device test --devices ... --module ...`; an aggregate
  run without `--module` also selected unrelated GraphQL/Arweave query helper
  vectors, seven of which fail against their shared test store. None of the
  five integrated device roots failed in either run.
- Focused EUnit passed 111/111 across the LBRY commitment, Odysee store,
  cache, hook, and Meilisearch worker modules.
- Chainquery importer tests, native comment control/revision tests, and static
  manifest tests passed.
- Frontend TypeScript compilation, normal production build, and static
  manifest production build passed. The manifest checker verified 958 files.
- Full frontend lint still reports three pre-existing constant-comparison
  errors in unchanged portions of `web/src/routes.js` and one pre-existing
  useless-spread error in the unchanged query smoke script. Full formatting
  still reports the pre-existing `ui/util/hyperbeam-playback.ts`; all changed
  frontend files pass targeted formatting. Targeted Oxlint over the changed
  frontend paths reports zero errors (warnings only).
- `pnpm run typecheck` reaches one pre-existing lint-style error in unchanged
  `ui/services/thumbnailUpload.ts`; `pnpm run typecheck:tsc` passes.
- `git diff --check` passes. Generated frontend build output remains ignored.

### Already Superseded On Master

| Neo work | Master state |
| --- | --- |
| `reply-id@1.0` workaround | Master already contains later generic POST/ID and signed-cache work. Re-evaluate the exact response contract; do not add another persistence device unless a reproducible gap remains. |
| Native comment query prototype | Master has later query batching, reply handling, edit behavior, and comment moderation. Neo is useful only as a contract comparison. |
| Basic upload index message | Master has upload ownership, chunking, manifests, listing, update, delete, duration, and mixed legacy/native behavior that must remain. |
| Basic immutable media rendering | Master has later playback metadata, range, legacy fallback, and product integration fixes. Port only verified store improvements not already present. |

### Retain From Master

- Account creation, login, hosted-wallet identity, settings, and synchronization.
- Upload ownership, index/list, chunk/finalize, update, delete, and tombstone
  behavior.
- Comment creation, replies, editing, control messages, moderation, and legacy
  fallback.
- Subscription behavior inside the account surface.
- Odysee claim/channel/search compatibility devices while callers still depend
  on them.
- Meilisearch, Chainquery import, Odysee ranking/filter translation, and mixed
  legacy/native search behavior.
- Current frontend application, SSR routes, debug console, authenticated
  product flows, and non-HyperBEAM fallback behavior.
- Existing per-kind LBRY commitment devices until unified-device parity is
  complete.

### Do Not Import

- The unrelated-history repository layout or wholesale `frontend/` rename.
- Removal of account, upload lifecycle, comment moderation, search, or other
  product devices before their behavior has a generic equivalent.
- Neo's removal of frontend search actions and its Lighthouse-only fallback.
- SQLite FTS5 as the production Odysee search backend.
- Static-manifest-only deployment.
- Known neo gaps: upload edit/delete failure, incomplete empty-query handling,
  unvalidated 35-million-document search performance, and rangeless media
  behavior where master already supports correct ranges.

## Execution Phases

### Phase 1: Baseline And Contract Freeze

1. Record exact branch heads and a clean worktree.
2. Inspect every neo commit and authored file rather than relying on the raw
   unrelated-history diff.
3. Build a symbol-level map from neo modules to current master modules.
4. Record master route, request, response, signature, identifier, and failure
   shapes for each affected product flow.
5. Run backend and frontend baseline validation and record pre-existing
   failures separately.

Gate: no implementation work begins until each neo component has an explicit
destination and each master behavior has an owner/test.

### Phase 2: Unified Native Commitment

1. Add a Forge-loadable `lbry@1.0` verifier to master.
2. Add unified evidence dispatch to the commitment library without deleting
   existing per-kind construction and verification.
3. Use b64u for embedded binary evidence and reject non-canonical encodings.
4. Re-derive every native ID and committed field from raw source evidence.
5. Cover blob, descriptor, transaction, claim output, stream, channel, and
   attestation evidence, including forged-kind and tampered-byte failures.
6. Validate old and unified commitment forms side by side.

Gate: all existing LBRY tests remain green and the unified device passes the
same corpus with no fail-open path.

### Phase 3: Store-First Source Layer

1. Refactor immutable transaction, claim-output, descriptor, and blob evidence
   reads so they do not invoke `~odysee-*@1.0` application devices. Preserve
   application-device routes for adjunct product data such as comments,
   reactions, and counts until their richer master behavior has a verified
   generic replacement.
2. Fetch legacy source objects through the narrow HTTP client helpers.
3. Construct and verify unified committed evidence before returning it.
4. Warm the local store under the canonical immutable ID returned by the
   verified object.
5. Preserve legacy compatibility paths as resolvers that produce an immutable
   ID, then use the same immutable read implementation.
6. Preserve current playback metadata, channel evidence, thumbnails, media
   source fields, and range behavior.

Gate: direct immutable reads work after source-service loss once cached;
tampered or mismatched source objects are never cached; legacy URL and claim-ID
entry points still render through the compatibility resolver.

### Phase 4: Generic Writes And Query Discovery

1. Compare neo's write flow with master's current signed-cache implementation.
2. Use generic signed POST/ID persistence wherever it preserves ownership,
   authorization, lifecycle, and stable response IDs.
3. Keep existing application devices as thin adapters for validation,
   ownership, mutation, and compatibility where generic writes are
   insufficient.
4. Ensure native comments, comment controls, uploads, upload revisions, and
   tombstones carry stable query fields.
5. Use `query@1.0` for exact native discovery and bare immutable-ID reads for
   hydration.
6. Deduplicate queries and hydration requests and preserve ordering.

Gate: create, restart, list, update, delete, and moderation workflows work for
native data, with legacy data still present in the same UI surfaces.

### Phase 5: Frontend And Manifest Integration

1. Port manifest-prefix, subpath, safe chunk-name, and hash-routing changes as
   an optional frontend build/deployment mode.
2. Keep current dynamic SSR routes and production configuration.
3. Consolidate immutable-ID hydration in the SDK facade rather than spreading
   page-specific resolution.
4. Resolve legacy names/claim IDs once, then render the returned immutable ID.
5. Preserve current account, upload, channel, comment, search, and debug-console
   behavior.

Gate: the same build passes normal local/SSR use and manifest-served use;
direct deep links, playback, auth, uploads, comments, and refresh persistence
work in both relevant modes.

### Phase 6: Search Contract Reconciliation

1. Keep `~odysee-search@1.0` as the product adapter and Meilisearch as the
   backend.
2. Add or adapt a generic after-write indexing seam for verified legacy reads
   and native writes.
3. Normalize configured scalar metadata and index it by immutable ID.
4. Make the generic search result an ordered list of immutable IDs only.
5. Hydrate IDs from stores in batches.
6. Keep Odysee-specific filters, recency/view/relevance weighting,
   current-version collapsing, moderation visibility, and pagination above the
   generic index contract.
7. Keep the Chainquery import resumable and idempotent; reconcile deletions and
   native messages without importing media bytes.

Gate: existing filters and sorting pass, legacy and native matches coexist,
deleted objects stay excluded, stable pagination has no duplicates, and the
generic layer does not return claim objects.

### Phase 7: Migration And Cleanup

1. Migrate one caller or producer at a time to unified commitments and direct
   immutable reads.
2. Measure usage of each compatibility device and old commitment form.
3. Remove a path only after no production caller uses it and equivalent tests
   pass through the replacement.
4. Keep explicit migration adapters for old cached messages and URLs where
   required.
5. Update shared architecture and operator documentation.

Gate: no master feature, legacy object, native object, or deployed URL requires
removed behavior.

## Validation Matrix

### Backend

- Compile the full HyperBEAM tree.
- Run existing LBRY codec, commitment, ancestry, attestation, store, remote
  store, Odysee corpus, and device suites.
- Add dual-format commitment vectors and malformed-evidence cases.
- Exercise source miss, verified warm, local hit, restart hit, remote-peer hit,
  source outage, timeout, malformed response, and native-ID mismatch.
- Exercise generic write/read/query across restart, duplicate writes,
  revisions, tombstones, and concurrent requests.

### Frontend

- Run formatting, type, lint, unit, and production build checks.
- Exercise normal SSR and manifest deployment modes.
- Verify playback, seeking, thumbnails, channels, uploads, edit/delete,
  account/settings, comments/replies/edit/moderation, subscriptions, search
  filters/sorts/dates, and debug-console traces.
- Test legacy-only, native-only, and mixed datasets.

### Search And Import

- Verify ID-only generic responses and batched hydration.
- Test exact, fuzzy, type, media, channel, date, duration, sort, safety, and
  pagination behavior.
- Test resumable bulk import, checkpoint recovery, idempotent replay,
  deletion reconciliation, and native-write indexing.
- Record index size, import throughput, query p50/p95/p99, and hydration cost on
  representative data before production sizing claims.

## Execution Outcome

All seven integration phases have been executed for the code-integration
scope. Deployment cutover, full-corpus import, and production performance
measurement remain operator activities and are not represented as completed
by this branch.

### Adopted Or Adapted

- Added the Forge-loadable `lbry@1.0` verifier and canonical b64u unified
  evidence conversion while retaining every existing per-kind commitment
  reader and verifier.
- Adapted `hb_store_odysee` so immutable transaction, claim-output,
  descriptor, and blob paths build and verify native evidence directly, warm
  the local cache under the canonical ID, and retain the richer master adjunct
  routes and range behavior.
- Hardened `query@1.0` empty-result, first-result, deduplication, signed-write,
  hydration, and restart behavior without replacing the upstream device.
- Added a non-recursive, failure-isolated cache after-write hook. The generic
  `search@1.0` device uses that seam when an operator configures it.
- Adapted Neo's generic search contract to Meilisearch: configured scalar
  fields (UTF-8 binaries, integers, floats, and booleans) are indexed, backend
  documents stay private, and queries return ordered immutable IDs only. The
  lazily started Meilisearch worker is node-owned rather than linked to the
  request process that first uses it.
- Kept `odysee-search@1.0` as the product adapter. It returns immutable IDs;
  browser and SSR SDK facades hydrate those IDs from stores with bounded
  concurrency before Redux or rendering sees product objects.
- Made native upload indexing restart-safe with a durable pending-operation
  queue, serialized queue updates, automatic bounded reconciliation, and an
  operator-gated full reindex action. Query latency does not wait for pending
  reconciliation: a node-throttled, single-flight background worker performs
  it without overlapping runs.
- Hardened the Chainquery importer with collision-safe IDs, task completion
  before checkpoint advancement, cursor/version/scope validation, deletion
  reconciliation, staging-index rebuild and swap, and native-document
  preservation during cutover.
- Added optional static-manifest build, publish, prefix, hash-routing, and path
  sanitization support while keeping normal SSR as the default.
- Ported the narrow Neo fixes still missing on master: UTF-8 header recovery,
  immutable `name#message-id` routing, rangeless full media reads, explicit
  `message-id` propagation, cache-media URL recognition, direct immutable
  playback diagnostics, and Meilisearch task polling.

### Superseded Or Rejected

- Did not merge unrelated histories, copy Neo's repository layout, replace the
  frontend, or remove current product devices.
- Rejected Neo's SQLite FTS5 backend, 40-hex mutable claim-ID treatment as a
  HyperBEAM immutable ID, static-only hosting, and broad frontend/device
  reductions.
- Did not add `reply-id@1.0`, `hb_odysee_node`, a second Odysee HTTP bridge, or
  `hb_odysee_util`; current master behavior already supersedes them.
- Retained current upload lifecycle, accounts, settings, comments,
  moderation, subscriptions, legacy fallback, playback, and per-kind LBRY
  compatibility surfaces.

### Final Neo Commit Audit

| Neo commit family | Result on master |
| --- | --- |
| Project skeleton, imported frontend, repository layout | Rejected; no unrelated-history merge or parallel tree. |
| LBRY parser/crypto ports and `lbry@1.0` verification | Adapted into current `hb_lbry_*` owners plus `dev_lbry`; compatibility retained. |
| `?IS_ID` 40-hex proposal | Rejected because a mutable claim ID is not an immutable HyperBEAM object ID. |
| Direct stores, cache warming, committed channel/source views | Adapted for immutable evidence paths; current range, proxy, SDK, and adjunct behavior retained. |
| Static SPA, hash routing, safe chunk names | Adopted as an optional manifest mode; SSR remains default. |
| HTTPSig/UI encoding and b64u evidence revisions | Adapted to canonical b64u unified evidence and current signed response handling. |
| Rangeless media support | Adopted without removing existing range support. |
| Deep-clean removals and reduced bridge/store family | Superseded or rejected where master has live product callers; narrow correctness fixes only. |
| SQLite `search@1.0` and write hook | Generic contract and hook adapted to Meilisearch; SQLite rejected. |
| Persist/reply-ID workaround and plain upload prototype | Superseded by generic signed ID responses and master's full upload lifecycle. |
| Immutable publish URL and UTF-8 header fixes | Adopted in the current frontend SDK/server paths. |
| Edge pin/rebase and build incident commits | No source port; current repository dependency/build state retained. |

### Neo Frontend File Audit

The Neo frontend started from a snapshot of the Odysee frontend and then
changed 25 files. The raw diff is therefore not a patch set for master. The
following table records the final disposition of every changed file group.

| Neo frontend files | Disposition on master |
| --- | --- |
| `HYPERBEAM-STATIC.md`, `index.html`, `manifest-prefix.ts`, `ui/index.tsx`, `vite.config.ts`, `settings.ts`, `use-get-poster.ts`, `push-supported.ts` | Adopted and adapted as the optional static-manifest build and publish pipeline. Normal SSR stays unchanged. Operator steps are recorded in `aidocs/hyperbeam-static-manifest.md`. |
| `claimTrace.tsx`, `hyperbeamPlaybackDebug/view.tsx`, `playback-url.ts` | Narrow immutable-store diagnostics and cache/media URL recognition adopted. Master retains the richer trace graph and playback metadata. |
| `nativeCommentControls.ts` | Adopted the `target-id`/`target_id` read aliases while preserving `target`, which is already present in deployed native records. A field-name migration is not hidden inside this integration. |
| `hyperbeam-file-info.ts` | Neo's direct `GET /<upload-id>` assumes its plain-message upload prototype. Rejected for master because master separates record and data IDs and needs range, authorization, lifecycle, and same-origin proxy behavior. Existing direct URLs are still preferred when a claim supplies them. |
| `hyperbeam-playback.ts` | Neo's direct immutable media route is already available in the master store and diagnostics. The master stream adapter remains the product fallback because it preserves protected-content handling, claim-ID compatibility, metadata construction, and legacy CDN fallback. Immutable store reads below that adapter are verified and range-aware. |
| `hyperbeamUpload.ts`, `publish.ts`, upload portions of `claims.ts` and `hyperbeam.ts` | Neo's plain committed upload record is superseded. Master keeps chunk/finalize, ownership, list, revision, edit, delete, tombstone, duration, and mixed legacy/native behavior. Only generic signed response-ID and immutable URL fixes were ported. |
| `search.ts`, search portions of `claims.ts` and `hyperbeam.ts` | Neo removed product search and reverted to Lighthouse. Rejected. Master keeps Meilisearch, Chainquery import, Odysee filters/ranking, native reconciliation, ID-only backend results, and bounded store hydration. |
| `stats.ts`, `payments.ts`, `reactions.ts`, `user.ts`, `lbry.ts`, `signInVerify/view.tsx` | Neo moved these surfaces back to legacy-only APIs. Rejected because master has functioning native account, settings, reaction, count, and authenticated proxy behavior that must remain available beside legacy fallback. |
| Remaining reductions in `claims.ts` and `hyperbeam.ts` | Rejected as a wholesale cleanup. Symbol-level review retained master-only account, comment, moderation, subscription, upload, search, playback, batching, retry, and compatibility contracts; only independently verified store-first fixes were adapted. |

### Operator Documentation

- Static-manifest build and publication: `aidocs/hyperbeam-static-manifest.md`.
- Chainquery import and Meilisearch reconciliation remain driven by
  `scripts/import-chainquery-meili.mjs`; its `--help`, versioned checkpoint,
  source scope, staging-index rebuild, and task-waiting checks are part of the
  operational contract.
- The full-corpus import, deployment cutover, and production latency/index
  sizing runs are intentionally not performed as part of a source integration.

### Final Regression Audit

- Every Neo commit family and each of the 25 Neo-modified frontend files has
  an explicit adopted, adapted, superseded, or rejected disposition above.
- No parallel Neo application tree, second SDK/bridge stack, SQLite backend,
  mutable-claim-ID shortcut, or static-only deployment path was introduced.
- Unified and legacy commitment forms remain readable; immutable reads verify
  kind and native ID before warming the cache; write-hook failures cannot roll
  back primary persistence.
- Generic search returns IDs only. Odysee ranking/filter compatibility stays
  in the product adapter, while browser and SSR callers hydrate through the
  shared immutable-store facade with bounded concurrency.
- Native indexing recovery is durable, bounded, asynchronous, and
  single-flight. Chainquery checkpoints advance only after Meilisearch tasks
  succeed, and staging cutovers preserve native documents.
- Focused backend, device, importer, comment, manifest, type, lint, formatting,
  and production-build validation introduced no integration failure.
  Repository whitespace and conflict-marker checks pass, and generated build
  output remains ignored.
- No source-level blocker remains. Full-corpus import, deployment rollout,
  and production-scale latency/index-size measurements are explicit operator
  activities rather than omitted implementation work.

## Completion Criteria

The integration is complete only when:

1. The adopted neo implementation exists in `master` through reviewed,
   master-compatible modules rather than a parallel replacement tree.
2. Unified commitment and store-first paths are cryptographically and
   behaviorally verified.
3. Current master product functionality remains available for legacy and
   native data.
4. Generic search returns immutable IDs and the product layer hydrates them.
5. All new and existing focused tests pass, broader validation has no new
   failures, and any pre-existing failures are documented.
6. A final branch-to-branch audit identifies every neo change as adopted,
   adapted, superseded, intentionally retained only in neo, or rejected with a
   reason.
