# Odysee legacy parity and broad-release audit — 2026-09-09

## Decision for today's presentation

The store-first architecture already supports a substantial native core. The next milestone is **completing and hardening the product workflows**, not rebuilding the former fleet of Odysee devices. Comment editing is implemented. Upload editing/deletion is also implemented now, but its metadata, revision, and search behavior needs repairs before calling the creator lifecycle complete.

Present the project as an implemented core awaiting broad-release hardening, not as full legacy parity or a production-certified deployment. The highest priorities are upload/search correctness, recoverable identity and creator migration, reports and policy enforcement, deliberate unsupported-route handling, and durable production operation.

## Scope and evidence standard

- Current application: `odysee-on-arweave-revised@a76da05`; initially clean worktree.
- Legacy frontend: `../odysee/odysee-frontend@bfc4e5ede`; initially clean worktree. Compared route families, service/action consumers, and web-server delivery capabilities.
- Legacy internal APIs: `../odysee/internal-apis@b21188f7`; inspected service inventory, notifications, and reporting. Other sibling projects such as Odysync, Portal, and permaweb libraries are adjacent products, not individually certified by this audit.
- Earlier HyperBEAM port: `../odysee-on-arweave@9c04652`; architecture/feature reference only, not an architecture to restore.
- Previous reports: [August 31 parity audit](../../docs/comparisons/odysee-legacy-production-gap-2026-08-31.md), [manual acceptance playbook](../../docs/projects/odysee-frontend-manual-acceptance.md), and the dated audit/acceptance history in [project knowledge](../../docs/projects/odysee-on-hyperbeam.md).
- “Both reports” was interpreted as the repositories plus these discovered reports; no separately attached reports were supplied.

This is a feature-family inventory, targeted source audit, and executable contract review. It is not a line-by-line proof of every file, live-service audit, dependency vulnerability audit, or fresh browser E2E certification. “Implemented” means source paths exist, with test evidence noted below. “Confirmed” findings are visible in source or reproduced locally; “risk” means the production manifestation still needs an integration test. Previously recorded test passes are not presented as today's results.

## Architecture to preserve

1. A static manifest frontend talks to the serving node. Production does not require a frontend SSR/proxy service.
2. Native creates use `POST /id?0.%21=true&committers=all`; the cookie hook signs the message and the response supplies `message-id`.
3. Exact objects are read with `GET /<ID>`; namespaced legacy locators use generic cache reads. `query@1.0` and `search@1.0` discover locators, then the integration boundary hydrates them.
4. Updates and deletes are new signed revisions/events. Public history and bytes are not erased by a tombstone. Generic stable references are available where logical identity must survive new snapshots.
5. Historical LBRY bytes are sourced through stores and verified by the single `lbry@1.0` commitment device. Metadata hints from an SDK/index do not establish authority.
6. Encryption, policy, analytics, and external delivery may need narrow boundaries or operator jobs. This does not imply a separate CRUD device for each feature.

Sources: [README](../README.md), [architecture](architecture.md), [store-first decision](../decisions/store-first-no-app-devices.md), [node setup](../src/hb_odysee_node.erl).

An Arweave-format path manifest and successful local committed-ID writes do **not by themselves establish Arweave network persistence**. The demo stack configures filesystem/LMDB and legacy source stores. Define and prove replication/permanent persistence, receipt tracking, retention, and restore before promising permanent uploads. See [configuration](../config.json), [manifest publisher](../odysee-frontend/build/static-manifest.mjs), and [operators](node-operators.md).

## Corrections to the previous reports

| Previous statement | Current conclusion |
| --- | --- |
| Upload edit/delete calls a removed application device or is unimplemented | Superseded by commit `750db19`. Generic revisions are wired through the upload service; remaining defects are below. |
| Private playlists are a future decision | Implemented: wallet-addressed WeaveMail encryption, stable references, private default, one-way public conversion. |
| Comment edits might be missing | Implemented in `fetchHyperbeamCommentEdit`; comment revision/control tests pass today. |
| Native view counts are unimplemented | Stale README limitation. Generic engagement and public counters exist; an Odysee creator dashboard remains separate. |
| Hiding unsupported menus remains entirely undone | Some cleanup landed, including YouTube sync sidebar hiding; deep routes still need capability gates. |
| Following-feed aggregation is wholly absent | Too categorical now: the Following page consumes subscriptions and the adapter contains native/legacy channel aggregation. Mark partial and test ordering/pagination, rather than claiming no implementation. |
| Historical comments are sourced behind the node | Documentation describes this, but the current comment list/by-ID integration is native-only. This is an actual migration/read-parity gap. |
| Google authentication is assigned to a particular person | The old report recorded an external workstream. No current assignment or completed merge is assumed by this audit. |

The root AGENTS guide also retains contradictory older instructions about SSR, a vendored `hyperbeam/` directory, upload devices, and Commentron devices. Follow the current README/decisions/code; reconcile these documents as a separate documentation task.

## Findings requiring work

Implementation follow-up (2026-09-09, uncommitted working tree): immediate
F1–F5 changes are implemented in
[native upload projection](../decisions/native-upload-projection.md): verified
owner/chain search reconciliation, stored tip locators, one current search
document per upload, full editable snapshots and clears, serialized writes with
verified acknowledged-head hints, and exact versus logical browser reads.
The findings below describe the audited baseline, not the patched tree.
See the decision's acceptance limits before treating every original acceptance
case as closed; broader identity, migration and production-readiness work remains.

### F1 — High: search rebuild bypasses revision authority and loses exact locator identity

**Confirmed source defect.** [Rebuild script](../scripts/reindex-node-uploads-to-search.mjs) removes commitments, groups by the claimed `revision-of`, sorts numerically, and selects the largest revision. It does not verify the signer, predecessor, contiguous chain, or forks. A foreign-signed message can therefore influence an operator rebuild's metadata or suppress a root using a claimed tombstone. This corrupts discovery, not the underlying immutable object.

The script merges edited metadata into the root and submits `{body: document}` without the original ID. [Search `message_id`](../src/dev_search.erl) derives an uncommitted content ID when an explicit ID is absent. Modified content has a different ID, but the script does not store that constructed object. An edited rebuilt hit can consequently point at an object that cannot be hydrated. Skipping tombstones also does not remove already-existing documents when replayed into a nonempty index.

**Work:** rebuild from exact verified evidence; reuse the same owner/chain projection as normal reads; index the intended logical locator explicitly; stage and replace the index or explicitly remove obsolete documents. Do not add revision semantics to generic search.

**Acceptance:** foreign/gapped/forked revisions cannot affect discovery; edited-title search resolves a stored authoritative object; deletion removes its discoverable entry; repeated rebuilds are idempotent; a failed rebuild leaves the old index usable.

### F2 — High: live search indexes revisions separately from their logical upload

**Confirmed source mismatch; live extent unmeasured.** [Configuration](../config.json) indexes all `odysee-upload@1.0` messages. [Generic search write](../src/dev_search.erl) indexes each message under its own content ID. Meanwhile [upload hydration](../odysee-frontend/ui/util/hyperbeam.ts) rejects standalone revision claims and hides tombstoned roots. Ordinary full-text search takes one ranked locator page and drops failed/null hydration results.

Thus revision hits can consume page slots without rendering, old root text can remain searchable, and deleted roots can remain ranked. The rebuild script is not a continuous solution. Native channel searches separately hydrate all matching uploads and apply a small filter subset/client sort; mixed native/legacy totals are based on a fetched prefix, not the full result set.

**Work:** an Odysee projection/materialization job should maintain one current search document per logical upload with an exact authoritative locator. Keep filters, supported sort semantics, and pagination explicit at the integration boundary; audit the existing bounded channel-query exception against the server-side search contract.

**Acceptance:** rename, retag, delete, channel filters, mixed-source Following, and page boundaries retain correct ranking/count semantics without dropped revision slots or browser filtering of ranked pages.

### F3 — Medium: upload edits silently omit fields and cannot clear existing values

**Locally reproduced.** [Upload service](../odysee-frontend/ui/services/hyperbeamUpload.ts) accepts tags/languages, but [revision serialization and normalization](../odysee-frontend/ui/util/nativeUploadRevisions.ts) omit them. The serializer also removes empty strings. [Metadata overlay](../odysee-frontend/ui/util/hyperbeam.ts) only applies defined values, and thumbnail replacement requires a truthy URL.

An edit with `description: ''`, new tags, and a new language produces none of those fields in the revision. Reload can retain the old description and old tags/languages despite a successful save. Partial subsequent edits can also lose prior revision-only metadata because the latest tip overlays the original root, not a merged effective snapshot.

**Work:** specify full-snapshot versus patch semantics; include all editable fields; distinguish unchanged from explicitly cleared; reject unsupported changes visibly. Extend update validation to match creation restrictions for paid/private/scheduled/transcoded modes.

**Acceptance:** change and clear every supported field, save twice, reload, search, and compare exact effective metadata. Changing unsupported visibility/media settings must not appear successful.

### F4 — High: upload saves can fork during query lag; duplicate commitment locators halt projection

**Locally reproduced at the projection layer; full network race still to test.** [Upload update/delete](../odysee-frontend/ui/util/hyperbeam.ts) obtains the tip afresh from the asynchronous query index. It does not use the serialized save queue and retained exact-verified head present in preferences. Two saves against an unindexed first save can both append revision 1. [Latest revision selection](../odysee-frontend/ui/util/nativeUploadRevisions.ts) sees two children and returns the root, hiding both successful edits.

The same selector requires exactly one candidate without collapsing equivalent commitment aliases. Two locators representing the same semantic revision also cause it to stop. A local synthetic duplicate-locator input reproduces this; whether the current node returns such a pair needs a live regression.

**Work:** serialize per-owner/per-upload saves, retain acknowledged exact heads through index lag, canonicalize equivalent physical locators, and expose genuine multi-tab conflicts with a recovery policy. Do not choose an arbitrary fork winner.

**Acceptance:** rapid save/save and save/delete under delayed indexing, reload during lag, two tabs, duplicate commitments, lost write responses, and retry.

### F5 — Medium: immutable upload routes currently project mutable state

**Confirmed source behavior, requiring a contract decision.** `resolveImmutableClaimById` reads the exact upload root, then queries later revisions and overlays metadata or returns nothing after deletion. It rejects revision IDs as standalone claims. The raw node `GET /ID` still preserves immutable bytes; the mismatch is in the browser's purported immutable claim route.

**Work:** distinguish the stable logical product URL from an exact historical snapshot route. If following the root's latest state is intentional, document that it is a logical route and preserve explicit access to prior verified snapshots. Test playlist references to edited/deleted uploads against the chosen semantics.

### F6 — High for migration: historical comments are not integrated

**Confirmed source gap.** [Comment list and by-ID](../odysee-frontend/ui/util/hyperbeam.ts) only load native messages. [Data-sourcing documentation](data-sourcing.md) describes Commentron signatures, but that recipe does not provide a working historical reader/import pipeline. Existing comment history, reply links, and legacy moderation cannot be counted as migrated.

**Work:** choose read-only compatibility evidence behind a source store, or a one-time import with provenance and original-signature verification where supported. Specify unavailable/deleted/unsigned historical content and old-to-new IDs. New writes remain generic native messages.

**Acceptance:** a legacy video with a known thread shows historical roots/replies plus new native comments, with honest provenance, stable pagination, deduplication, and no direct Commentron browser request.

### F7 — High: reporting still sends browser product data to a legacy host

**Confirmed source boundary violation.** [Report service](../odysee-frontend/ui/services/reportContent.ts) posts to `reports.odysee.tv`; [router](../odysee-frontend/ui/component/router/view.tsx) still exposes reporting. The legacy fetch guard does not specifically include this report origin.

**Work:** operator-addressed private/encrypted report intake with attachments, acknowledgement, and workflow, or deliberately unavailable reporting until that exists. A report is not automatically an authoritative public blacklist entry. Reuse generic messages where suitable; policy enforcement stays with upstream blacklist hooks.

**Acceptance:** reports reach the configured operator, sensitive reporter data stays out of public messages, confirmation reflects successful intake, and no report request uses the legacy product host.

### F8 — High for launch: cookie identity is not a complete account lifecycle

**Confirmed limitations; no live attack test.** [Account helper](../odysee-frontend/ui/util/hyperbeamAccount.ts) keeps the credential cookie on sign-out and deletes `secret-*` cookies in browser JavaScript for fresh signup. [Pinned cookie provider](../_build/default/lib/hb/src/preloaded/auth/dev_cookie_auth.erl) stores the secret as a scalar cookie value rather than explicitly attaching production cookie attributes. Sign-out currently hides the account; it is not credential revocation. Private playlist decryption exports the owner key into an in-memory map in [integration code](../odysee-frontend/ui/util/hyperbeam.ts).

**Work:** production cookie attributes, write-origin controls, true session termination/revocation, key-cache clearing, recovery/export, deliberate account switching, and multi-device/node migration. Making cookies HttpOnly requires replacing the JavaScript cookie-clearing flow. Test these properties at deployed ingress; infrastructure can change effective cookie behavior.

**Acceptance:** logout prevents further authorized use under that session; recovery restores the same committer and private state; fresh signup cannot accidentally strand an existing account; request credentials/private keys never enter public storage. Existing node-restart persistence is useful but does not prove these properties.

### F9 — Medium: hidden menus do not disable retained deep links

**Confirmed routing gap.** [Router](../odysee-frontend/ui/component/router/view.tsx) sets its authentication predicate to `selectUserAuthenticated || hyperbeamUploadEnabled()` and mounts wallet, notifications, channel-new, posts, reposts, rewards, livestream, and other legacy pages. Sidebar cleanup is partial. This is a UI capability problem, not evidence that server-side signer checks are bypassed.

**Work:** one explicit capability map used by menus, buttons, routes, and actions. Deep links must resolve to an intentional unsupported state or a working native flow. Avoid empty stubs and silent success.

**Acceptance:** visit every retained route directly, signed in and out, on a manifest; no unsupported flow spins indefinitely or attempts a blocked legacy transport.

### F10 — Release gate: policy, persistence, scale, and deployment evidence remain incomplete

[Blacklist patch notes](../patches/README.md) state geographic enforcement is not activated in the demo config pending merged upstream pinning. The configured local storage stack is not a tested durable multi-node deployment. Broad `Promise.all` hydration in upload/channel/reference paths and target-wide comment projection need realistic volume/failure tests, even where per-read worker pools already exist.

**Work:** provision/test node policy; pin/publish required devices and runtime patches; verify remote replication with all intended commitment kinds; same-origin HTTPS; backup/restore of public data, private wallets, and indexes; migration rehearsal; quotas/rate limits; search rebuild/failover; monitoring and rollback. Explicitly validate TEE/TLS attestation if that trust claim is part of launch.

**Acceptance:** restore a clean node and recover identical IDs, owners, playlists, preferences, and playback; survive seed/search outages; prove range/policy behavior; measure first-load and large-library/thread performance on the exact release manifest. Dependency/CSP/abuse testing is outstanding, not certified by this report.

## Complete feature-family disposition

| Legacy surface | Current state | Remaining work / appropriate boundary |
| --- | --- | --- |
| Signup/login/logout | Cookie-native profile creation and restoration exist | Recovery, revocation, switching, portable ownership; narrow auth/session boundary. |
| Password/email/verification/wallet sync | Legacy model intentionally replaced | Do not restore old authority; decide external identity binding and migration. |
| Channel view/attribution | Native profile renders; exact committer establishes ownership | Profile metadata revisions, avatar/banner editing, stable channel references. |
| Multiple channels/import/deactivation | Legacy actions call blocked `channel_create/update/import/abandon` | Generic owner-bound profile/reference events; verified legacy creator claim process. |
| Basic file upload/thumbnail/listing | Implemented, owner-scoped | Retry/reconciliation, media-size limits, failed-upload cleanup/retention, native edit bugs F1–F5. |
| Scheduled/unlisted/private/paid uploads | Unsupported by native create eligibility | Explicit product contracts; metadata tags alone must not promise confidentiality/access control. |
| Remote URL upload/transcoding | Native create requires local Blob and rejects optimization | Optional operator ingest/transcode workers producing committed derivatives and provenance. |
| Playback/seek | Historical verified bytes and native media paths; single ranges | Cross-browser/mobile codecs, long/large media, outage/range tests. Multipart ranges optional. |
| Captions/transcripts/chapters/downloads | Inherited player/UI surfaces are not proof of complete native authoring or migration | Inventory actual media representations and authoring paths; test accessibility, downloads, subtitles, external artwork. |
| Native comments/replies/edit/delete | Implemented; revision suite passes | Index-lag/large-thread/browser acceptance; historical parity F6. |
| Comment hide/pin/heart/creator block | Native append-only controls implemented | Creator ownership migration, delegates, blocked words, durable user mute/block state. |
| Rich emoji/stickers/super-chat/mentions | Not a complete native contract | Rich reaction schemas/assets; mention notifications; payment-backed chat deferred with economy. |
| Video/comment likes/dislikes | Implemented with verified owner projection | Scale, abuse, aggregation and failure testing; preserve one current reaction per owner/target. |
| Content reports/appeals | Legacy report transport retained | F7; operator workflow and response/appeal contract. |
| Global/geographic restrictions | Patch and browser handling exist; demo activation incomplete | F10; signed policy generation, country data, response/media enforcement and rollout. |
| Public/private playlists | Implemented stable reference snapshots and WeaveMail | Saved deletion/tombstones, browser recovery/large-list verification; owner identity recovery. |
| Queue/Watch Later/Favorites | Intentionally local | Decide encrypted cross-device sync separately; do not silently publish. |
| Free follows/bell preference | Implemented append-only relationship | Native aggregate subscriber counts, legacy import; bell state is not notification delivery. |
| Following feed | Partial native/legacy channel aggregation exists | Correct supported filters/order/totals and scale; test actual feed, not only follow toggles. |
| Notifications/inbox/read state/push/email | Retained actions still call legacy notification API | Generic private inbox/read events plus delivery workers and preferences; gate until functional. |
| Homepage/categories | Node-materialized signed snapshots exist | Refresh/failure/freshness, localization and local-content coverage in deployed node. |
| Search/discovery/channel filters | Generic search plus adapter paths exist | F1/F2; schema parity, stale/deleted objects, ranking, pagination, importer operation. |
| Personalized FYP/recommendations/related videos | Legacy recommendation transport blocked | Optional privacy-aware materialization from native signals; explicit cold-start behavior. |
| Watch history/resume | Local/inherited surfaces | Define encrypted cross-device snapshot/event model, retention and clear-history semantics. |
| Posts/articles and reposts | Screens retained; native publishing contract missing | Generic committed post/repost messages, immutable targets, revisions, indexing and rendering. |
| Public view counts | Generic qualified analytics implemented | Abuse/aggregation/migration baseline validation; not “unimplemented.” |
| Creator analytics/dashboard | Public counts do not provide legacy dashboard parity | Authenticated product adapter over generic analytics if selected; gate old dashboard. |
| Livestream ingest/view/chat/replay | Legacy signing/signaling/WHIP/status paths disabled | Separate media infrastructure project plus signed metadata/chat/control events. |
| YouTube sync/bulk transfer | Native sidebar now hidden; no native importer | Optional operator import workers, creator authorization, resumability and provenance. |
| Wallet/tips/support/purchases/rentals | Legacy economy not natively ported | Choose payment/entitlement/settlement contract before implementation; do not restore SDK proxy. |
| Memberships/Premium/payouts/rewards/referrals | Legacy services/screens retained | Explicit business scope and migration decisions; hide unsupported paths. |
| Preferences/theme/language/tags | Encrypted native snapshots/references implemented | Browser/multi-device acceptance depends on identity; keep follows/moderation out of preference blob. |
| SEO/Open Graph/Google Video/RSS/oEmbed/social frames | Legacy web server implements crawler-facing routes | Node/edge metadata responses or generated immutable artifacts; hash fragments cannot supply per-item server metadata. Test embeds separately from copied links. |
| Static UI assets/creator artwork/localization | Manifest templates/assets exist; historical remote images allowed | Own asset availability, mobile/keyboard/screen-reader/RTL acceptance; document external thumbnail availability/privacy. |
| Operational/admin tools | Local demo, patches, importer and analytics tools exist | F10; deployment/backup/reindex/runbook evidence, administration authority and report triage. |

Legacy evidence anchors: [frontend route inventory](../../odysee/odysee-frontend/ui/page), [legacy web routes](../../odysee/odysee-frontend/web/src/routes.js), [legacy notification events](../../odysee/internal-apis/app/notifications), [legacy reports](../../odysee/internal-apis/app/reports/content.go). Current anchors: [SDK boundary](../odysee-frontend/ui/lbry.ts), [legacy guard](../odysee-frontend/ui/util/hyperbeamLegacyBoundary.ts), [channel actions](../odysee-frontend/ui/redux/actions/claims.ts), [notification actions](../odysee-frontend/ui/redux/actions/notifications.ts), [Following page](../odysee-frontend/ui/page/channelsFollowing/view.tsx), [analytics contract](odysee-analytics.md).

## Work packages you can present today

| Priority | Work package | Definition of done |
| --- | --- | --- |
| P0 | Finish upload revisions and search projection | F1–F5 covered by metadata-clear, foreign-writer, fork, delayed-index, exact-read, rename/delete/search and browser regressions. |
| P0 | Recoverable account and creator ownership | Same committer across recovery; real logout; profile edits; verified legacy channel migration; explicit multi-channel decision. |
| P0 | Reports, policy and capability gates | Native/operator intake, configured enforcement, honest deep-link behavior and no legacy product requests. |
| P0 | Production persistence and release rehearsal | Durable storage/replication, wallet backup/restore, search rebuild/failover, load/security checks, exact-manifest browser acceptance. |
| P1 | Historical data migration | Explicit plan for comments, channels, uploads, subscriptions, playlists, preferences/history and view baselines; repeatable import with provenance. |
| P1 | Public web and discovery completeness | Crawler/share/embed metadata; reliable Following and search; subscriber counts. |
| P1 | Notifications and moderation settings | Native inbox/read state and delivery; delegate/block-word events with verified authority. |
| P2 | Posts/reposts, richer discovery and creator tools | Generic message contracts and tested UI; independently choose dashboard and recommendation scope. |
| Separate roadmap | Livestreaming and monetization | Funded scope for media/payment infrastructure, entitlements, operations and migration. Not a prerequisite for an explicitly narrower video beta. |

P0 means a gate for the corresponding broad-release promise, not that every legacy feature must exist for a controlled beta. For example, creator migration can be excluded from an explicitly new-account-only beta, but not advertised as existing-creator parity.

Suggested presentation wording: “We have the store-first native core: upload/playback, comments including editing, reactions, private/public playlists, follows, preferences, homepage/search, and view counting. The next work is upload/search consistency, complete account and creator lifecycles, migration, reporting/policy, and production durability. Notifications, posts, livestreams and the economy are separate missing product layers; most new state still fits generic signed messages.”

## Verification performed today

Passed: `typecheck:tsc`; `test:native-upload-revisions`; `test:native-comment-revisions`; `test:native-comment-controls`; `test:native-message-verification`; `test:hyperbeam-session`; `test:native-reactions`; `test:native-playlists` (including references/private envelopes); `test:native-subscriptions`; `test:native-preferences`; `test:static-manifest`; `test:hyperbeam-search-options`; `test:manifest-homepage` (including thumbnail boundary).

Additional local assertions reproduced omitted empty-description/tags/languages fields, duplicate-locator chain stopping, and two sibling revisions reverting the projection to the root. These exercised the actual exported upload revision helpers; they did not perform live writes or prove real-node timing.

Not run: backend compile/EUnit/core suite, frontend lint/check and full manifest build, live cookie/browser workflows, load/failover/restore, external service verification, vulnerability scans or penetration tests. The repository changes are this audit document only; no application fixes, commits, deployments, or data migrations were performed. `git diff --check` is the final document hygiene check.
