# Chrome acceptance for native images and legacy capture

This is a test plan, not a new passing report. It covers the shared image uploader,
portable thumbnail IDs, thumbnail removal, avatar/banner editing, upload-player
regression and the legacy capture pilot. Section 9 links the wider product audit.

## Copy this brief to your Chrome tester

Test the current image-workstream build using this entire checklist. Use disposable
accounts/content only on an operator-approved test node. Report PASS / FAIL /
BLOCKED / NOT RUN per case, with observed evidence. Do not fix code, force clicks,
restart nodes/Meili, publish manifests, change operator config, run real legacy
captures or modify real user content without separate approval. Continue independent
cases after a failure. An unavailable fixture is BLOCKED, not PASS. Do not reload
to hide an immediate-retry failure. The capture importer has no UI: Chrome cannot
certify it; use the explicitly separate terminal suite or mark it NOT RUN.

## 0. Verify the target before testing

Confirm that the supplied build includes the image-reference and editor fixes
under test. An older master manifest is not a substitute. Test-only asset
interception is distinct from a published manifest; do not reuse a fake manifest
path from a previous automation run.

Obtain an operator-provided, freshly built manifest URL that includes the current
changes and is served on the cookie node's origin. If absent, mark **SETUP BLOCKED**
and request a target; do not invent a URL or report an old build as current.
Use [RUN_DEMO.md](../RUN_DEMO.md) and the manifest build/publish instructions in
[README.md](../README.md) for separately authorized operator setup. Do not repoint
the node's shared search backend just to make the canonical build succeed.

Record:

```text
Manifest URL:
Node origin:
Frontend commit + working-tree/build identifier:
Backend/config identifier supplied by operator:
Build transport: published manifest / test-only intercepted local assets
Chrome version / OS / viewport:
Account A (owner), account B (foreign), C (guest): labels only
Search + native upload projection worker ready: yes/no
Legacy image/claim fixture ready: yes/no
Run label: image-qa-<date>-<unique suffix>
```

Use separate Chrome profiles/contexts for A and B, and a clean guest context C.
Two incognito windows share one incognito session; they are not independent users.
In DevTools, Preserve log; disable cache only for cold-load cases. Never export
cookies, auth headers, HARs, storage dumps or wallet responses. In particular,
do not inspect/copy `~secret@1.0/export` payloads. Evidence should contain only
public IDs, request path/method/status, screenshots and redacted errors.

## 1. Fixtures and evidence ledger

Have these ready; mark missing formats/edge cases BLOCKED rather than making claims:

- A playable MP4, ideally 30–60 seconds, with a unique title/URL for this run.
- Two visibly different PNGs. Available fixtures: frontend
  `ui/component/channelThumbnail/gerbil.png` and
  `ui/component/selectAsset/thumbnail-missing.png`.
- Small valid JPEG, WebP and GIF; a zero-byte file; text/SVG renamed `.png`;
  a truncated image; valid image over **5,242,880 bytes**; decodable 8193×1 image.
- For compatibility: an operator-provided old URL-based upload and, separately,
  a legacy outpoint/channel record with public image URLs. Do not guess fixtures.

Keep these identifiers separate:

| Label | Meaning |
| --- | --- |
| DATA | MP4 byte-message ID; stays unchanged during metadata edits. |
| IMG1 / IMG2 | Original/replacement image byte-message IDs. |
| U0 / U1 / U2 | Upload metadata root/replacement/clear revision IDs. |
| P0 | Stable native profile ID. |
| P1 / P2 / P3 | Saved profile metadata revisions, not the stable profile ID. |

Read `message-id` on successful generic-write responses. Distinguish image-byte
writes from JSON `odysee-upload@1.0` / `odysee-profile-revision@1.0` metadata.
Do not navigate away merely because the write returned 200: wait for the UI's
success acknowledgement/readback to complete.

## 2. Upload + thumbnail lifecycle

1. **IMG-01 — Create.** A signs up, opens Upload, selects the MP4, waits for Ready
   to Upload, clicks Next, sets a unique title and selects PNG1 in the thumbnail
   picker. Confirm Upload, then finish the wizard and Publish. Expect success,
   no permanent spinner, visible thumbnail and working video playback. Record DATA,
   IMG1 and U0; reload the owner upload page and open the item again.
2. **IMG-02 — Stored reference.** Inspect the upload metadata write: nonempty
   `thumbnail-id` equals IMG1; `thumbnail-url` is absent or empty. It must not store
   `blob:`, `data:`, a local filesystem path or a node hostname as this native image
   reference. Metadata and raw image bytes use `/id?0.%21=true&committers=all`.
3. **IMG-03 — Replace.** Open Edit, confirm Current thumbnail is IMG1, upload PNG2,
   Update and record IMG2/U1. Expect IMG2 != IMG1, `thumbnail-id: IMG2`, empty URL,
   unchanged DATA and unchanged logical upload identity. Reload and reopen Edit;
   the current preview must be IMG2, not an optimistic blob preview.
4. **IMG-04 — Unrelated edit.** Change only title/description, save and reload.
   The image must remain IMG2; tags/language must not be accidentally lost. Record
   this additional version separately so later checks use the correct latest ID.
5. **IMG-05 — Remove.** Click Remove thumbnail, Update, record the clear revision
   as U2. Expect both thumbnail fields empty in the revision. Reload and reopen
   Edit: no Current thumbnail. Public display may use its normal placeholder,
   but must not resurrect IMG1/IMG2 as the current thumbnail. Video still plays.
6. **IMG-06 — Exact history.** Open `<MANIFEST>/#/$/id/<U0>` and the exact saved U1
   in C. U0 retains IMG1; U1 retains IMG2 even after clearing the current upload.
   Confirm actual image responses succeed and decode—not merely that a request was
   sent. If autoplay hides a poster, also check that version's public metadata and
   exact image URL. Opening `<NODE>/<IMG1>` and IMG2 must still return the originals.
7. **IMG-07 — Fresh viewers.** B/C open the current friendly upload link, cold
   reload, and see the current thumbnail state, not A's cached form. Neither can
   use A's edit controls. UI visibility alone does not prove signed-writer rejection
   (see section 7).

## 3. Avatar/banner lifecycle

1. **PROFILE-IMG-01 — Save.** A opens their channel → Edit. Set display name/bio,
   avatar PNG1 and banner PNG1, wait for uploads, Save profile. Record P0/P1 and
   avatar/banner IDs. Reload channel and editor: images load, name/bio persist,
   handle/P0 stay unchanged. B/C see the saved public profile.
2. **PROFILE-IMG-02 — Replace independently.** Replace only avatar with PNG2,
   save/reload: banner remains unchanged. Then replace only banner, save/reload:
   avatar remains unchanged. Capture each revision and image ID.
3. **PROFILE-IMG-03 — Remove independently.** Remove avatar → save/reload: default
   avatar, banner unchanged. Remove banner → save/reload: no old custom banner.
   Clear bio and save; no old bio should return. The profile/content owner stays A.
4. **PROFILE-IMG-04 — History and guest.** After replacement/removal, C opens
   `<MANIFEST>/#/$/id/<P1>`: old display metadata/images remain. The stable channel
   URL shows the latest profile. B cannot enter a working editor for A.

## 4. Format and validation matrix

Run each applicable input through **thumbnail, avatar and banner** separately.
For valid formats, save metadata and reload; preview alone is not a pass.

| Input | Thumbnail | Avatar/banner |
| --- | --- | --- |
| Valid PNG / JPEG / WebP, within limits | Accept each | Accept each |
| Valid GIF, within limits | Accept | Reject |
| Empty / spoofed text or SVG / corrupted image | Reject | Reject |
| More than 5 MiB | Reject | Reject |
| Width or height above 8192 | Reject | Reject |

**VALID-01:** Valid bytes go to the node with the image MIME type; fresh guests can
load saved public images. No CDN upload, SSR thumbnail bridge or server signer
is required. Save/reload must work for every claimed accepted format.

**VALID-02:** Invalid inputs show an understandable validation error before any
image-byte POST, do not write broken profile/upload metadata and do not crash the
editor. Close the error and select a valid image: the UI must recover. Observe
Network; do not infer “no write” from the absence of a success toast.

The browser's 5 MiB/dimension/type/decode checks are UX preflight, not node-side
enforcement or image sanitization. Unlike the importer, browser preflight does not
certify every GIF frame or impose the importer's total-frame-pixel budget.

## 5. Failure and immediate retry

- **RETRY-01 — Image bytes.** With the wizard already open, set DevTools Network
  Offline, select a valid thumbnail and confirm upload. Expect an error, not success
  or a successful metadata save. Restore Online, acknowledge the error, select the
  same file again and upload **without reload**. Finish Publish/Update; refresh and
  verify the saved image. Repeat for avatar and banner. A failed replacement alone
  must not mutate the already-committed public profile/upload.
- **RETRY-02 — Profile metadata.** Upload images while online and change bio/name.
  Go Offline immediately before Save profile. Expect retained editable values and
  no fake success. Go Online and retry without reload; verify A and C after reload.
- **RETRY-03 — Upload metadata.** Upload/select an image while online; go Offline
  before Update. Expect no false success. Restore Online, retry without reload;
  verify the resulting version and image. Report lost draft values or spurious
  ownership rejection as failures; do not silently re-enter fields to claim recovery.
- **RETRY-04 — Injected 503 / invalid acknowledgement.** These require a controlled
  interceptor, not merely Offline mode. Use the existing automated suites below;
  report their results separately. Do not claim malformed-ID coverage from a normal
  successful write or change the shared node to simulate an error.

## 6. Player, routing and layouts

- **UX-01:** Play an actual video and verify its playback clock advances. Navigate
  within the SPA to Settings so it floats and continues playing. Navigate to Upload
  **without a document reload**. Expect no floating overlay/audio carrying over.
  Choose a video and click Next normally. Do not manually close or force-click
  through the player to pass this case.
- **UX-02:** Open a playable owned upload, immediately click Edit, upload/replace
  its thumbnail and click Next/Update. No late player should reappear over the
  wizard. Repeat quickly a few times; the race may not occur on every navigation.
- **UX-03:** Metadata-only edit with no replacement video finishes on a content/
  upload route, not `/$/livestream`. Playback and exact old DATA remain available.
- **UX-04:** Repeat primary upload/profile controls at desktop and ~390×844 device
  emulation, 200% zoom, keyboard Tab/Enter/Escape. Dialogs and Next/Save/Remove
  controls remain reachable. Report emulation, not actual mobile-browser coverage.

## 7. Compatibility, authority and discovery gates

- **COMPAT-01:** With an old URL-based upload fixture, load it unchanged, edit an
  unrelated field and then replace/clear the thumbnail. Old exact versions retain
  their URLs. Arbitrary remote URLs are not converted into native IDs just because
  their last segment has 43 characters. If no fixture exists, BLOCKED.
- **COMPAT-02:** With actual legacy claim/channel fixtures, check thumbnail/avatar/
  banner rendering. Direct legacy image rendering is compatibility, not migration
  or independence from the image host. Do not report a legacy ownership migration.
- **AUTH-IMG-01:** Run foreign/stale profile-write rejection through the existing
  profile harness against a disposable node. A generic write can return 200 while
  product projection correctly rejects its signer/predecessor. The pass condition
  is unchanged authoritative owner/current state after cold hydration, not HTTP 403.
- **AUTH-IMG-02:** Run thumbnail foreign/stale/malformed-reference contract tests.
  These are not a browser adversarial-write run; label the evidence accordingly.
- **DISCOVERY-01:** Only with Meili **and** the native projection worker configured:
  new/changed thumbnails appear in search/channel/Following after reconciliation,
  with no duplicate logical uploads. Record delay and exact returned version IDs.
  Missing worker/index means BLOCKED, not a reason to restart shared services.
- **PORTABLE-01:** Different-node-base URL construction is covered by contracts.
  Live cross-node acceptance needs a second approved node with the exact image
  bytes/evidence available and an appropriate frontend target. A page on one node
  does not prove replication or availability on another. Otherwise BLOCKED.

## 8. Automated companion — terminal, not Chrome UI

From `odysee-frontend/`, after obtaining the fresh target:

```sh
HYPERBEAM_MANIFEST_URL='<ACTUAL_MANIFEST_URL>' \
HYPERBEAM_TEST_VIDEO='/absolute/path/to/30-second-test.mp4' \
pnpm exec playwright test \
  tests/specs/native/hyperbeam-thumbnail.spec.ts \
  tests/specs/native/hyperbeam-profile-edit.spec.ts \
  tests/specs/native/hyperbeam-upload-revisions.spec.ts \
  tests/specs/native/hyperbeam-floating-upload.spec.ts \
  --project=chromium --workers=1

pnpm run test:native-images
pnpm run test:native-images:browser
pnpm run test:native-upload-revisions
pnpm run test:native-profiles
```

Leave `HYPERBEAM_TEST_ASSET_DIR` unset when certifying a published manifest. If an
operator deliberately uses intercepted local assets, label that run accordingly;
ordinary Chrome opened at the fake manifest URL will not have those assets.
Playwright's bundled Chromium is not automatically the user's installed Chrome.

### Importer: CAPTURE-01 to CAPTURE-04

From the repository root; this suite has **no external network** at runtime:

```sh
node --experimental-strip-types --test scripts/plan-legacy-images.test.mjs
docker build --target test -f scripts/legacy-image-capture.Dockerfile -t odysee-image-capture:test scripts
docker run --rm --read-only --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --cpus=1 --pids-limit=32 --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  odysee-image-capture:test
```

- **CAPTURE-01:** Inventory recognizes stream thumbnails and channel avatars/
  banners, keeps immutable outpoints, and flags incomplete banner export coverage.
- **CAPTURE-02:** Fixture suite covers hostile URLs/IPs, redirects, TLS hostname
  validation, MIME/corruption, byte/decode budgets and worker limits.
- **CAPTURE-03:** Fixture suite covers resume, hash verification, duplicate bytes,
  explicit retries, interrupted writes, corrupt/symlinked files and writer locking.
- **CAPTURE-04:** Only with a separately approved public export/host list, follow
  [the capture runbook](legacy-image-capture.md): offline validation first, then a
  small bounded capture. Re-run unchanged: captured jobs must not refetch. Receipts
  must say `published: false`, `historical_bytes_verified: false`, and retain source/
  hash provenance. Never corrupt a real capture to test recovery—use the fixture
  suite or a disposable copy. Without approval/fixtures this live case is BLOCKED.

Expected suite baseline: four inventory tests pass; Linux importer suite has 18
passes and one host-Node interoperability skip. Host suite with pinned Pillow/
OpenSSL has 17 passes and two Linux-only skips, covering the Node interop case.
Dependencies may download at build time; the test container itself runs offline.
Importer success must not be presented as node publication, restored history,
creator ownership transfer, production storage, sanitization or replication.

## 9. Whole-product regression beyond this image slice

For “everything” across earlier work, also run the existing
[master Chrome kit](chrome-master-acceptance.md) against **the same new target**.
Its September 17 manifest/commit label is historical, not the target for this run.
Carry over its fixture/operator gates and record cases separately. Prior passes
do not automatically count as passes against today's bundle.

At minimum smoke: signup/session persistence → upload/play/seek → profile edits →
comments/replies/edit/author-delete → video/comment reactions → creator pin/heart/
hide/unhide and guest refresh → private/public playlist save/delete/history and
offline retry → follow/bell/unfollow → upload/reply notifications and read-state
refresh → encrypted preferences reload. Search/Following mixed-source pagination,
legacy source behavior, policy/MMDB and persistence need their own prerequisites.
Keep Google auth/recovery work with Ayush; unsupported product routes/features are
not newly implemented by the image changes.

## 10. Paste back this result

```text
Target: <manifest> | <node> | <commit + local build identifier>
Transport: published manifest / intercepted assets
Browser: Chrome version, OS, viewport
Accounts: A/B/C labels only

PASS: <case IDs + what was actually observed>
FAIL: <case ID, exact steps, expected/actual, sanitized paths/statuses>
BLOCKED: <case IDs + missing prerequisite>
NOT RUN: <case IDs>

Public fixture ledger: DATA / IMG1 / IMG2 / U0 / U1 / U2 / P0 / profile revisions
Immediate retry without reload: passed/failed/not run
Guest exact-history reads: passed/failed/not run
Foreign/stale evidence: UI only / contract / live harness
Search worker + legacy fixtures: available/unavailable
Importer: fixture suite / approved live capture / not run

Verdict: native-image acceptance only / broader regression status
No claim of production migration, ownership transfer or replication.
```
