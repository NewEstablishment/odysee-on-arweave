# Master Chrome acceptance kit — 2026-09-17

Target: master `15f3674` (PR #10 merged). This is a test plan, not a passing report.
Use the exact deployed manifest/build revision in every result. Later master
changes require a new recorded target. Do not assume an old manifest updates.

## Copy this brief to the Chrome tester

Test the node-served Odysee manifest against every section below. Use only
disposable test accounts/content on an approved test node. Do not change code,
restart services, republish manifests, modify policy/indexes, or touch real user
content. Report PASS, FAIL, BLOCKED or NOT RUN per case; missing fixtures are
BLOCKED, not PASS. Continue independent tests after a failure. Do not silently
reload to hide a retry failure. Capture sanitized evidence, not credentials.

## 0. Target, setup and fixtures

Fill these before starting:

```text
Manifest URL: <MASTER_MANIFEST_URL>
Node origin: <NODE_ORIGIN>
Frontend build commit: <verified commit>
Backend build commit/config identifier: <operator-provided>
Chrome version / OS / viewport:
Run label: qa-master-<date>-<unique suffix>
Search index + native projection worker ready: yes/no
Legacy source reads ready: yes/no
Analytics / policy enabled: yes/no + operator config reference
```

- Obtain a manifest built from the target master and served on the cookie node's
  origin. A manifest from a merge candidate is useful evidence but must be
  labelled as that candidate, not a fresh master deployment.
- Use three isolated Chrome profiles: **A creator**, **B viewer/foreign writer**,
  **C guest**. Incognito windows share one incognito session: two such windows
  are not two independent accounts. Two tabs in A are for same-owner concurrency.
- Open DevTools: Network Preserve log, Console, Application. Start normal online;
  use Disable cache for the explicit cold-load checks, not throughout the run.
- Do not export HAR files, cookies, wallet responses, auth headers or storage dumps.
  `~secret@1.0/export` can contain private wallet material: never screenshot/copy it.
  Record public message IDs, request path/method/status and redacted errors only.
- Prepare a real playable 40–90 second MP4, audio file, PNG/JPEG/WebP image,
  invalid image file and Markdown sample if that upload type is exposed.
- A and B each create a native profile and at least one real upload. Prepare an
  A video for comments, native channel URLs, a known legacy video **outpoint**
  and full legacy channel ID supplied by the operator. Do not guess live fixtures.
- For real pagination: a populated index with at least 60 eligible uploads across
  native and legacy followed channels, spanning three pages with known dates.
  An operator-controlled test index can include missing locators on pages 1/2
  and an entirely missing page. Do not corrupt production data to create this.
- Keep an evidence ledger: account label, logical URL/root ID, immutable version
  IDs before/after writes, item order, visibility and expected owner. No secrets.

## 1. Boot, routing and general UI

- **BOOT-01:** Cold-open manifest as C. Home renders without blank screen, endless
  spinner, missing JS/CSS, inappropriate asset MIME types or repeated app crashes.
- **BOOT-02:** Open content/channel/playlist URLs directly; hard refresh, back,
  forward and duplicate tab. Hash routes stay beneath the same manifest prefix.
  Unknown and unavailable IDs show an intentional state, not unrelated content.
- **BOOT-03:** Test desktop 1440×900 and Chrome device emulation around 390×844:
  navigation, search, player, modal, dropdown and editor stay usable without
  clipped primary actions. Device emulation is not actual mobile-browser proof.
- **BOOT-04:** Keyboard Tab/Shift-Tab, Enter, Escape, focus in/out of dialogs;
  readable labels/errors, zoom 200%, light/dark themes. No keyboard traps.
- **BOOT-05:** Slow network and cold reload: loading/error/retry is understandable;
  one failed thumbnail does not blank the entire feed. Capture unexpected 429s.

## 2. Native account and isolation

- **AUTH-01:** Create A with name-only signup. Empty/invalid input cannot silently
  create a broken account. No email/password/legacy account request is needed.
- **AUTH-02:** Reload and reopen the tab: same profile and owner-bound operations
  remain available. Display name or localStorage alone must not grant ownership.
- **AUTH-03:** B/C view A's profile/content: no working A edit/delete controls and
  no private playlist/preference/inbox content leaks.
- **AUTH-04:** Sign out: account and private inbox disappear from UI. Record whether
  the same cookie remains and whether supported sign-in restores the account.
  UI sign-out is NOT proof of cookie revocation. Do not delete the only owner's
  cookie as a recovery experiment; recovery is a separate identity workstream.
- **AUTH-05:** If account switching is supported, switch while a request is slow:
  old account's data must not appear or be written under the new account. Mark
  unavailable account-switch UI BLOCKED, not a tested security guarantee.

## 3. Profile editing

- **PROFILE-01:** A edits display name and bio, saves, reloads; B sees changes.
  Original handle/profile ID and content/social ownership remain unchanged.
- **PROFILE-02:** Add avatar/banner; preview, save, refresh, inspect loaded image.
  Remove each and clear bio; changes persist. Cancel must preserve saved state.
- **PROFILE-03:** Invalid image bytes/type and oversize inputs produce validation,
  not broken persisted metadata or a crash. Use limits shown by this build.
- **PROFILE-04:** Fail a save using section 13; edits remain retryable. Two rapid
  saves must not silently lose acknowledged state. Exact prior profile version
  still reads its original metadata; friendly channel route shows current state.

## 4. Upload, metadata revisions and deletion

- **UPLOAD-01:** Upload a real video with title/description/thumbnail/tags/language.
  Progress ends in acknowledged success; it appears in owner uploads and plays
  after refresh. Repeat supported audio/image/Markdown paths, if exposed.
- **UPLOAD-02:** Inspect writes: bytes and upload metadata use generic committed
  messages. No legacy TUS/transcoder preparation or channel-signing dependency.
- **UPLOAD-03:** Edit each supported metadata field, then explicitly clear optional
  fields; save twice and reload. Updated values appear on current product routes.
  Previous immutable versions retain exact old metadata and media identity.
- **UPLOAD-04:** With worker/index configured, updated metadata reaches channel,
  search and Following without duplicate roots. Old search text stops matching
  after reconciliation. Record observed delay; absent worker means BLOCKED.
- **UPLOAD-05:** Cancel deletion first. Delete a disposable upload, reload library
  and current discovery; it is suppressed after reconciliation. Previously saved
  immutable record/media reads still work. Logical deletion is not byte erasure.
- **UPLOAD-06:** Failed upload/save/delete must not show false success; retry must
  work or show a clear conflict. Record duplicates, orphaned uploads or stuck
  progress. Unsupported visibility/payment/scheduling must not silently succeed.

## 5. Playback and related content

- **PLAY-01:** Native and known legacy video: start, pause/resume, seek forward/back,
  near end, finish, replay, volume/mute, speed and fullscreen; refresh deep link.
  Test captions/audio controls where the fixture actually supplies them.
- **PLAY-02:** Inspect media requests during seek: valid single-range responses
  (206 when ranged), no repeated overlapping fetch storm or hidden second player
  generating preview sprites. Legacy output-zero fixtures are especially useful.
- **PLAY-03:** Slow/offline interruption then online: player recovers or offers
  actionable retry without app crash. Missing media gets honest unavailable state.
- **PLAY-04:** Related results load via node search, exclude current item and open
  the correct exact content. No browser legacy recommendations request.
- **PLAY-05:** Switching videos stops the old playback; playlist next/previous,
  shuffle and queue work without two simultaneous audio streams.

## 6. Home, categories, search and discovery

- **SEARCH-01:** Home/category render real cards with working thumbnails; selecting
  a card opens the corresponding item. Compare a homepage row with its category's
  shared initial pool. Exercise language changes where snapshots are provisioned.
- **SEARCH-02:** Category infinite scroll across at least three pages: no duplicate
  tiles, stall, repeated first page or endless requests after exhaustion.
- **SEARCH-03:** Exercise every exposed sort/filter, including type, tags, language,
  duration and freshness. Changed criteria start at page one; clearing filters
  restores results. Back/forward/refresh retains correct criteria and ordering.
- **SEARCH-04:** Text search with known native/legacy titles, partial query, no
  matches, Unicode and punctuation. Search controls reach the node; React must
  not manufacture correctly filtered results from an incorrectly ranked page.
- **SEARCH-05:** Verify future/no-thumbnail/ineligible content against the configured
  category contract: signed homepage excludes future items; Local content may
  retain scheduled content. Do not impose one rule on both surfaces.
- **SEARCH-06:** With operator-provided missing-locator fixtures: pagination survives
  partial/empty hydration; source failure is not presented as a successful empty
  library. Last complete homepage snapshot should survive refresh failure.

## 7. Follows and Following — critical merge regressions

- **FOLLOW-01:** B follows A from channel and a second exposed entry point. Repeat
  for a real legacy channel. Follow persists after reload; new bell defaults off.
- **FOLLOW-02:** Following mixes native/legacy records in expected newest order;
  oldest sort reverses correctly. Scroll three pages, refresh, back/forward.
  No duplicates, skipped first page or independently concatenated source lists.
- **FOLLOW-03:** Missing locators on pages 1 AND 2 must not block page 3. Entirely
  unhydratable first page must continue without needing a scroll event.
- **FOLLOW-04:** After loading feed cards, unfollow on the channel. **Follow button
  must remain available.** Feed removes that channel, resets pagination and stays
  correct after reload. Re-follow works and does not duplicate the relationship.
- **FOLLOW-05:** Toggle bell off/on and reload; preference persists independently
  of following itself. Offline toggle does not remain falsely acknowledged.
  Separate this test from notification delivery in section 11.

## 8. Comments, replies, edits and author deletes

- **COMMENT-01:** B posts root and nested reply on A's video; both profiles see
  correct text, attribution, hierarchy and counts after refresh. Test Unicode,
  multiline text, cancel and visible input limits; plain HTML must not execute.
- **COMMENT-02:** B edits own comment twice. Latest text displays once, retaining
  replies/logical identity. A cannot edit B's text. Prior raw immutable messages
  retain original text; do not confuse exact evidence with current thread UI.
- **COMMENT-03:** Cancel author delete, then confirm. Deleted body disappears from
  current thread; descendant handling/counts stay coherent and survive refresh.
- **COMMENT-04:** Change sort and paginate a populated thread; no duplicates or
  lost replies. Offline post/edit/delete retains recoverable input and retries
  without creating duplicate visible comments or claiming ownership falsely.
- **COMMENT-05:** Historical legacy comment migration is not implemented here.
  Test native comments on legacy targets separately; an empty historical thread
  must not be reported as successful legacy comment migration.

## 9. Reactions and creator moderation

- **SOCIAL-01:** On video AND comment: like, remove, dislike, switch to like;
  reload and view from A/B. At most one active reaction per owner/target; counts
  never inflate on repeated clicks or go negative. Check failed-write recovery.
- **MOD-01:** A hides/unhides B's comment, pins/unpins and hearts/unhearts. B/C see
  intended state after refresh. B cannot invoke A's creator-authorized controls.
- **MOD-02:** A blocks/unblocks B through creator controls; verify existing/replied
  thread visibility and restored state according to the UI contract. Do not
  treat generic storage of B's messages as bypass: projection is authoritative.
- **MOD-03:** Hidden/deleted/blocked ancestors must not expose suppressed content
  through replies or notification links. Delegates and blocked-word settings are
  separate unimplemented contracts, not passes from testing these controls.

## 10. Playlists — run for private AND public

- **LIST-01:** Create named playlist: private by default. Add native and resolved
  legacy items, reorder, remove, save, refresh. Item order and stable URL persist;
  no explicit blockchain publish/republish, bid or collection SDK write.
- **LIST-02:** New copy defaults private. Edit title/description and supported
  metadata; cancel preserves state. Add/remove operations acknowledge saves.
- **LIST-03:** Private URL in B/C: no title/description/items/images in UI or raw
  stored snapshot plaintext. A can decrypt after refresh. Private owner metadata
  selectors may be public; do not mistake them for leaked playlist contents.
- **LIST-04:** Make private playlist public: explain irreversible disclosure, retain
  stable URL, B/C can read. No public-to-private promise. Old private snapshots
  stay ciphertext; a public historical snapshot never becomes private later.
- **LIST-05:** Delete dialog: wrong name disables, exact name enables; cancel leaves
  everything unchanged. Confirm removes library entry, including after refresh.
- **LIST-06:** Stable URL now shows **Playlist deleted**, including B/C and fresh
  load. Media remains available. Exact historical public snapshot still displays
  old contents; exact private snapshot requires A and is ciphertext to B/C.
- **LIST-07:** Offline preflight: wait >30 seconds without owner reads or use the
  automated fixture, go offline, delete, then immediately retry ONLINE without
  reload/TTL wait. No false success offline; retry succeeds without spurious
  'Only the playlist owner' error. Also test a failed reference-write retry.
- **LIST-08:** Two A tabs edit/save stale versions: no silent stale overwrite or
  resurrection after deletion; a clear retry/conflict is acceptable. Do not claim
  cross-device atomic compare-and-swap. Queue/Watch Later/Favorites remain local
  and must not be confused with committed saved playlists.

## 11. Native in-app notifications

- **NOTIFY-01:** B follows A with bell OFF; A uploads: no upload notification.
  Enable bell, wait beyond that second, A uploads new content: notification
  appears after normal polling/focus. Allow ~60 seconds and record actual delay.
- **NOTIFY-02:** B comments; A replies: B receives reply with correct author,
  video and logical comment destination. Self replies and upload metadata edits
  must not generate new-activity duplicates.
- **NOTIFY-03:** All/Replies/New uploads filters, header badge, individual read,
  mark all read, dismiss; hard refresh and reopen. Acknowledged state persists.
  Explicitly check the known **'notification account changed' after reload** error.
- **NOTIFY-04:** Bell off/unfollow removes that channel's upload projection;
  re-enable starts a new opt-in interval, not an arbitrary historical upload dump.
  Hidden/deleted/blocked replies and restricted targets must not leak in inbox.
- **NOTIFY-05:** Two B tabs read/dismiss different notifications; refresh both.
  Acknowledgments form a union. Failed receipt write stays visibly retryable;
  sign-out clears private inbox and stale in-flight updates cannot restore it.
- **NOTIFY-06:** Stored receipts are encrypted, not plaintext notification IDs,
  titles or bodies. Browser push/email and legacy-channel upload notifications
  are NOT implemented; do not equate in-app bell state with those deliveries.

## 12. Encrypted preferences and analytics

- **PREF-01:** Change two supported shared settings (e.g. theme and language),
  save/allow sync, reload/reopen same account. Rapid changes retain latest state.
  Verify an encrypted preferences write; a local-only setting is not sync proof.
- **PREF-02:** Offline save then online retry, account isolation, unavailable
  snapshot recovery. No plaintext preference payload at rest, legacy wallet-sync
  fallback, or preference overwrite of follows/moderation/local playlists.
- **VIEW-01:** When analytics is configured, observe page/route and playback
  start/heartbeat/pause/complete/end requests to the node. Paused/background time
  must not manufacture active watch time; preview is not a qualified view.
- **VIEW-02:** Play longer than configured threshold (default 30 seconds), inspect
  public totals with the operator's known baseline. Rapid starts/reloads do not
  blindly inflate counts; documented completed replay may count again. Browser
  must not contact legacy Watchman/view-count APIs. No creator dashboard is implied.

## 13. Shared failure, concurrency and transport checks

Repeat on comment, reaction, follow, profile, playlist and preferences writes:

- **FAIL-01:** Open editor first; DevTools Network Offline, attempt save, record
  error and retained draft, restore No throttling, retry immediately. Finish with
  reload and a fresh reader where public. Do not clear cookies/storage to recover.
- **FAIL-02:** DevTools Request blocking can simulate unavailable read/write URLs;
  remove blocking before retry. It is not an HTTP-503 simulation. Use approved
  automated interception for a genuine synthetic 503 or failure after snapshot
  write but before reference write. Never deploy a fault proxy to production.
- **FAIL-03:** Double-click and save from two tabs; observe acknowledged state,
  stale conflicts and duplicates. A request with lost response has ambiguous
  outcome: reconcile it before retrying, do not assume no write happened.
- **NET-01:** Product writes use `/id?0.%21=true&committers=all`; discovery via
  generic query/search yields locators; reads hydrate exact IDs/store paths.
  Existing crypto/analytics boundaries are legitimate exceptions to plain ID reads.
- **NET-02:** No direct browser Commentron, SDK proxy, Lbryio, Lighthouse,
  Meilisearch, recommendations, wallet-sync, Watchman or geo/policy-list calls.
  Distinguish permitted thumbnail/media assets from forbidden product APIs.
  If reporting targets `reports.odysee.tv`, record the gap but do NOT submit it.
- **NET-03:** Generic storage may accept a signed foreign revision and return 200.
  The PASS criterion is that verified product state ignores it, not HTTP rejection.
  UI-only hiding does not prove writer/signature validation; see section 15.

## 14. Policy, unavailable capabilities and operational gates

- **POLICY-01 (operator fixtures):** Known allowed, globally denied, region-denied
  and location-unavailable content; direct link, search card and playback routes
  show node decisions (451 / affected 503) without leaking restricted media.
  Chrome location emulation does NOT alter server IP-based country decisions.
  Missing policy/MMDB deployment is BLOCKED, not proof of enforcement.
- **CAP-01:** Check menus AND direct routes for memberships/premium, payments/tips,
  wallet/rewards, livestream, YouTube sync, extra legacy channels, reports/appeals,
  creator analytics, posts/reposts and moderation settings. Unsupported actions
  should be deliberately unavailable, not endless spinners, false success or
  fallback Web2 writes. Record currently exposed gaps; do not spend money/send reports.
- **CAP-02:** Copy public links into fresh Chrome; distinguish working navigation
  from untested SEO/Open Graph, RSS/oEmbed and social previews. Hash-route content
  alone does not prove crawler-visible per-item metadata.
- **OPS-01:** Browser-only testing cannot certify persistence. After separately
  approved operator restart/restore, reopen saved IDs with the same A cookie:
  ownership, media, private playlists, preferences and receipts must survive.
  Never restart another person's node or run cache/index deletion as cleanup.
- **OPS-02:** Operator-supervised search/seed outage and recovery, populated
  large-library/thread/inbox, rate limits and cold-load timing. Record latency and
  dataset sizes, not an unqualified scalability claim. Google login/recovery
  stays Ayush's work; list it as separately owned, not covered by native signup.

## 15. Automated companion checks (operator, disposable node only)

These commands CREATE signed fixtures. Do not run against real user production
state. They supplement Chrome UI testing; do not mark an unrun command PASS.

```sh
cd odysee-frontend
export HYPERBEAM_MANIFEST_URL='<MASTER_MANIFEST_URL>'
export HYPERBEAM_BASE_URL='<NODE_ORIGIN>'
pnpm exec playwright test --project=chromium --workers=1 \
  tests/specs/native/hyperbeam-following.spec.ts \
  tests/specs/native/hyperbeam-playlist-deletion.spec.ts \
  tests/specs/native/hyperbeam-profile-edit.spec.ts \
  tests/specs/native/hyperbeam-upload-revisions.spec.ts \
  tests/specs/native/hyperbeam-social-reliability.spec.ts
pnpm run test:native-cookie-comments
pnpm run test:native-cookie-reactions
pnpm run test:native-cookie-playlists
pnpm run test:native-cookie-subscriptions
pnpm run test:native-cookie-preferences
```

Upload/search lifecycle additionally runs index reconciliation. Only after the
operator has configured a disposable index matching the test node's search
configuration, run it with explicit destinations (never inherited defaults):

```sh
MEILI_URL='<TEST_MEILI_ORIGIN>' MEILI_INDEX='<DISPOSABLE_INDEX>' \
  pnpm run test:native-cookie-upload-revisions
```

Following's automated search responses are controlled: it does not replace live
mixed-source section 7. Social reliability needs its legacy-channel fixture and
uses non-playable media bytes; it does not replace real playback section 5.
Notification automation needs the separate Vite harness documented in
[native notifications](../aidocs/native-notifications.md); it is not silently
included in the manifest command above.

Run native message-verification, revisions, playlist/reference, reaction,
subscription, preference and notification contracts for foreign/stale/tied/forked
state rejection. Signature forgery/tampering cannot be certified by screenshots.
See [README validation](../README.md#local-validation) and
[merge validation](pr10-merge-validation.md) for commands and existing evidence.

## 16. Result format and sign-off

```text
Master Chrome run: <commit> / <manifest> / <node> / <Chrome + OS>
Fixtures: native + legacy + index/worker/policy readiness
PASS: <case IDs>
FAIL: <case IDs>
BLOCKED: <case IDs + missing prerequisite>
NOT RUN: <case IDs>

Each failure:
ID / severity / account role / URL or public immutable ID
Steps / expected / actual / reproducibility
Request method + path + status; sanitized console error
Screenshot filename; persistence after refresh; workaround if any

Release verdict: ready for <explicit scope> / not ready
Owners and next actions for failures + blocked gates
```

Immediate blockers: unauthorized state changes, private-data exposure, lost
acknowledged state, false success, unplayable known-good media, legacy product
writes, broken core routes or unrecoverable normal retry. Known gaps still count
against the relevant release promise; do not hide them as expected passes.
The September 17 merge candidate passed four focused browser tests, not this
entire matrix. EUnit analytics timeout, fresh homepage generation with an empty
index, live legacy mixing, notification reload recovery, production persistence,
identity recovery and operational/security acceptance remain separate evidence.
