# Native QA closeout — September 18

Baseline: master `cb64bc6`, plus the local floating-renderer correction described
below. No auth, search-service or shared-node configuration changes.

## Local testing link

[Open the QA manifest](http://127.0.0.1:18812/VB7FflVj7sjUOlLfq74wqiG1yXx3TRNRPAy2S-cRCI8/#/)

Published 970 assets to the existing local node; the publisher verified the served
index matches the compiled index. This is a local candidate built from `cb64bc6`
plus the uncommitted playback correction, not an unchanged-master or production
deployment. The loopback URL works only on the machine running this node.

**Direct-manifest validation: all four Chromium tests passed (2.3 minutes).**
No local asset interception was enabled. This includes creator Hide/Unhide across
owner/guest reloads, full 60-second playback/replay/floating/upload navigation,
preference exact-read fault recovery, and metadata edit/history/no livestream
redirect. The preference test deliberately injects read failures; the remaining
tests use the real node without response substitution.

## Findings and corrections

- Both external Hide harnesses selected exact text **Hide**, which invokes
  personal channel mute, rather than the creator menu item **Hide comment**.
  That run did not establish a creator visibility event or a persistence defect.
- Strengthened the checked-in visibility test to require a successful
  `odysee-comment-control@1.0` / `visibility` / `hidden` write, and a visible sibling
  comment after owner and guest reloads before asserting the hidden root/reply
  are absent. This avoids passing before comment hydration has finished.
- A new playable-MP4 regression reproduced a genuine remaining wizard defect,
  including after a clean rebuild. The form cleared playback, but the floating
  renderer's route effect restored the old URI. The shared stream wrapper now
  skips playback bootstrap when it is already rendering the floating player.
  Existing UI-selected playback remains responsible for selecting that URI;
  fetching missing media for a newly selected floating/queue URI is retained.
- The test observes real media progress and an actual floating viewer on Settings,
  then performs same-document navigation to Upload. It requires disappearance
  and a normal, unforced Next click. Reloading into Upload would not test this race.

## Validation

Four real-node Chromium workflows passed using test-only local asset transport:
Hide/Unhide with owner/guest reload, real playback-to-upload transition, metadata
edit/exact history/no livestream redirect, and injected preference-read recovery.
TypeScript, lint (zero errors, six existing warnings), comment controls/revisions,
preferences, shared read-cache/session, static-manifest contracts and bundle
validation pass. The bundle uses existing generated homepage input; this does not
certify fresh homepage materialization or live search.

The final candidate also completed the full 60-second fixture at normal speed,
then replayed and passed the floating transition. Live cookie-owned comment and
reaction suites pass, including same-owner revision chains and forged-revision
rejection. One rerun stopped before playback due to a mistyped fixture path;
correcting the path produced the final passing run. Backend suites were not rerun
for this frontend-only change.

Reproduce the browser checks (use an ordinary playable MP4 of at most 90 seconds):

```sh
cd odysee-frontend
HYPERBEAM_MANIFEST_URL='<published local manifest URL>' \
HYPERBEAM_TEST_VIDEO='/absolute/path/to/test.mp4' \
HYPERBEAM_TEST_FULL_PLAYBACK=true \
pnpm exec playwright test --project=chromium --workers=1 \
  tests/specs/native/hyperbeam-comment-visibility.spec.ts \
  tests/specs/native/hyperbeam-floating-upload.spec.ts \
  tests/specs/native/hyperbeam-upload-revisions.spec.ts \
  tests/specs/native/hyperbeam-preference-readback.spec.ts
```

For pre-publication testing only, add `HYPERBEAM_TEST_ASSET_DIR=web/dist/public`.
Omit that variable for direct manifest acceptance. These tests create disposable
native accounts/messages. They do not export authentication state.

## Human walkthrough (pending a person performing it)

Use a normal browser for account A and an incognito window for account B. Do not
export cookies or store authentication state in test artifacts.

1. A: create a test account and upload a short, playable MP4 with a unique title.
   Open the uploaded result and watch the entire clip; check sound, seek and reload.
2. While playing, navigate to Settings (player should float), then Upload. The
   floating player should disappear. Select a file and click Next normally.
3. Open the first upload, edit metadata without choosing a new file, and save.
   Confirm success and that no livestream route opens.
4. B: open A's video, add a comment and reply; toggle a reaction.
5. A: select **Hide comment**, not **Hide**. Reload both windows: B's root and
   reply should be absent from the public thread. Keep another visible comment
   as proof that the thread loaded. A's Hidden comments panel should show the root.
6. A: Unhide; reload both windows and confirm the root returns. Check the reply.

Report commit/build URL, browser, MP4 duration, each step's result and any error.
Automated playback is useful evidence but is not a human picture/sound sign-off.
Legacy mixing, production load, policy, recovery and replication remain separate.
