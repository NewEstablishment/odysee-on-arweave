# Native QA fixes — September 17, 2026

Implemented on master `15f3674`, without changing node configuration or Google
authentication. The earlier manual acceptance document/README edits are preserved.

## Changes

- Entering the upload/create or metadata-edit wizard clears previous playback.
  Its floating viewer no longer intercepts Next/Update. Native no-file metadata
  saves also cannot take the legacy livestream redirect, which the expanded
  browser regression exposed after successful update acknowledgement.
- Preference snapshot/reference readback retries unavailable exact evidence up
  to three times with 250/750 ms waits. It never repeats the POST. Commitment,
  owner, timestamp, reference identity and target checks remain mandatory;
  invalid or exhausted readback still fails. This hardens a demonstrated failure
  mode, not a diagnosis proving the node's intermittent load-related root cause.
- Creator Hide writes the existing generic owner visibility event; Hidden
  comments offers paginated restoration, including hidden replies. This list
  stays separate from the public Redux thread. Public lists and linked replies
  suppress hidden/deleted/blocked ancestors; immutable history remains exact.
  Author deletion remains author-only. Unsupported native moderator-delegation
  menu entries are no longer offered.

## Validation and reproduction

TypeScript, lint (six existing warnings), native comment/revision/verification,
session/read-cache, reaction, playlist, subscription, preference, notification,
Following, homepage and static-manifest contracts pass. Added tests execute the
actual preference writer and visibility boundary, including foreign-owner
rejection, exhausted readback and descendant suppression.

The production bundle and static asset checks pass using existing generated
homepage input. Canonical `build:manifest` still fails because the stopped search
service returns no homepage locators. A parallel test publisher hit HTTP 400;
the serial retry was stopped before rebuilding the final bundle. No completed
new manifest deployment is claimed.

Browser tests can use the compiled assets at the same origin as real node APIs:

All three tests below passed against the final bundle (27.6 seconds): owner/guest
hide and restoration across reload, complete upload metadata edit/exact history,
and preference recovery with injected read failures and no duplicate writes.

```sh
cd odysee-frontend
HYPERBEAM_TEST_ASSET_DIR=web/dist/public \
HYPERBEAM_MANIFEST_URL=http://127.0.0.1:18812/fBAZPPAbRDJj_dJbe6v4Pm0bJmvfdDuShbjs6XENSNo \
pnpm exec playwright test --project=chromium --workers=1 \
  tests/specs/native/hyperbeam-comment-visibility.spec.ts \
  tests/specs/native/hyperbeam-upload-revisions.spec.ts \
  tests/specs/native/hyperbeam-preference-readback.spec.ts
```

The optional asset transport is test-only: it intercepts the manifest prefix,
not API writes, exact reads or signature verification. It does not modify the
old immutable manifest. Omit `HYPERBEAM_TEST_ASSET_DIR` to test a newly published
manifest directly. Always use a disposable node/account; tests create messages.
Media bytes in these fixtures do not establish real-video playback acceptance.

The preference browser test injects two HTTP-503 exact reads for each successful
write, then requires verified recovery with exactly one snapshot and one
reference POST. It is not a production load test. No backend code changed;
backend suites, live mixed-source ordering, notification dismissal and operator
restart/restore are not newly certified by this slice.
