# Image storage and migration

Human QA: [Chrome image-workstream kit](chrome-image-acceptance.md), including
current-build prerequisites, exact history, retry and separate importer checks.

## Current acceptance limits

October 1: five Chromium workflows pass on a freshly built reduced-homepage
bundle against an isolated real HyperBEAM node, using test-only asset transport.
Coverage includes delayed-upload disabled state, image interruption and profile
save while offline followed by immediate retry without reload, one successful
revision without reposting saved image bytes, fresh guest profile/thumbnail
reads and exact history, and Edit/new-upload navigation during decoded playback.
Image retry explicitly reselects the file; it is not an automatic upload queue.

TypeScript, formatting/lint (six existing warnings), native profile/image/upload
contracts and the reduced bundle build pass. This is not published-manifest,
canonical homepage, live search, cross-node replication or production acceptance.
Lost acknowledgements after a node accepts a write, video-upload metadata offline
recovery and production migration remain separate gates. Backend/importer suites
were not rerun for these rendering changes.

## Image editor behavior

- Cover/avatar selectors now use the shared image URL boundary rather than
  unconditionally upgrading HTTP to HTTPS. Configured node schemes are retained;
  native avatars no longer depend on having a banner.
- Profile uploads and saves have distinct visible operation states, native
  disabled controls and a synchronous in-flight guard. Preview/action space is
  reserved so image loading does not move Save. A successful metadata write keeps
  its acknowledged head even if the subsequent display refresh fails.
- Native Edit clears playback in the shared prepare-edit action before routing;
  the wizard/floating-renderer guards remain as defense against late playback.
- The channel editor wrapper retains component identity across parent renders.
  Recreating it previously discarded drafts and re-read the profile on offline
  transitions. Native editor scroll clearance keeps Save reachable above fixed
  status notifications without forced clicks.

The profile contract suite executes selector/component/action code with
controlled hooks and transports: HTTP/HTTPS covers, avatar without a cover,
upload busy state, stale/duplicate clicks, retained-image retry, and playback
clear-before-navigation. These are not browser tests. Enhanced profile/floating
browser specs require slow-upload disabled state, exact cover CSS URL, guest
state/history and one normal Edit click during real playback. The offline
regression is `hyperbeam-image-recovery.spec.ts`. Playback destinations use
separate fresh contexts so abandoned edit drafts do not contaminate new-upload
acceptance. A cleared cover may render the default gradient, but no image URL.

## Native image uploads

Thumbnails, avatars and banners share the browser `nativeImageUpload.ts`
validator and generic raw-byte `POST /id?0.%21=true&committers=all` transport.
No image device, SSR bridge, external upload service or new signer is added.

- At most 5 MiB and 8192 × 8192; matching MIME/signature plus successful decode.
- Thumbnail picker hints, selection checks and frame re-encoding thresholds use
  the same native size constant instead of the inherited CDN configuration.
- PNG/JPEG/WebP for profile images; thumbnails also retain existing GIF support.
- The original bytes are uploaded unchanged, with cookie credentials only on
  the request. Redirects are rejected. Failed writes, missing acknowledgements
  and malformed message IDs cannot produce a successful image result.
- Profile adapters return the immutable ID; the thumbnail adapter preserves
  its existing SDK-shaped URL result. Profile revisions already store IDs.
- This is browser preflight, not server-enforced content safety or a decode
  memory limit. Generic byte writes remain generic. Image-specific ingestion
  enforcement, total decoded-pixel/frame budgets and safe serving need a
  separate reviewed boundary; a browser restriction cannot secure a node.
- GIF decode acceptance does not validate every animation frame. This slice
  neither rewrites metadata nor claims EXIF stripping or image sanitization.

## Portable thumbnail references

New uploads and edits persist `thumbnail-id` for native image references.
The existing thumbnail service still returns a URL to the form, but the shared
write boundary converts only an exact configured-node `/<43-character-ID>` URL.
Remote hosts, relative paths, query/fragment URLs and lookalike hosts are not
reinterpreted. Explicit IDs are validated; conflicting nonempty ID/URL metadata
is rejected. No new device, proxy or signer is introduced.

The ID/URL pair is one logical metadata field. Setting either clears the other;
explicit empty values remove the thumbnail; an unrelated edit preserves it.
Both full snapshots and old sparse URL revisions follow this rule. Hydration
builds native image URLs against the active node; search projection retains
`thumbnail_id` and sets `has_thumbnail` without persisting a serving hostname.
Old URL records and exact historical snapshots are unchanged. Another node
must still have or be able to source the bytes: portability is not replication.

The picker now exposes Remove thumbnail. Live acceptance also reproduced a
playback callback race after entering the editor: mount-time cleanup alone
could leave a floating viewer over Next. The floating renderer now suppresses
itself on the upload route and clears late playback state.

### Acceptance evidence

Four Chromium workflows passed against a fresh, isolated HyperBEAM on `:18824`
using the production-built frontend with test-only local asset interception.
API reads/writes and commitment verification reached the real node. This is
not a deployed/published manifest acceptance run.

- Thumbnail wizard: injected 503 byte-write failure and immediate retry, create,
  exact-byte image readback, ID-only metadata,
  replace, clear, reload, and a fresh guest reading original/replacement images.
- Profile editor: invalid-image rejection, avatar/banner save and replacement,
  failed metadata save/retry, clear/reload, fresh guest, foreign/stale rejection
  and exact historical avatar/profile reads.
- Upload revision regression: metadata clear, refresh and exact version history.
- Floating playback regression: actual playback continues while floating on
  settings, then is removed on entering upload; Next is clicked normally.
  An initial 3-second fixture ended before the timing assertion; the 15-second
  fixture passes. The thumbnail replacement test also asserts no floating viewer.

Contracts additionally cover thumbnail foreign/stale revisions, malformed IDs,
old remote URL compatibility, metadata-only saves, search facets and rendering
the same ID with a different node base. These are not live cross-node replication
or Meilisearch-service tests. The real-decoder fixture covers all supported image
types and failed-byte-write retry. Full frontend contract suites, TypeScript,
format/lint (six existing warnings) and the standalone static bundle pass.
No backend code changed; backend suites were not rerun. Canonical homepage
materialization, manifest publication and production-scale image storage were
not exercised; the isolated node deliberately has no search backend.

Re-run `hyperbeam-thumbnail.spec.ts`, `hyperbeam-profile-edit.spec.ts`,
`hyperbeam-upload-revisions.spec.ts` and `hyperbeam-floating-upload.spec.ts` with
`HYPERBEAM_MANIFEST_URL` and a playable `HYPERBEAM_TEST_VIDEO` lasting at least
15 seconds. For built-bundle transport only, set `HYPERBEAM_TEST_ASSET_DIR` to
`web/dist/public`; omit it to test an actual published manifest.

## Legacy source audit

The sibling `../odysee/odysee-frontend` publishes images to
`IMG_CDN_PUBLISH_URL` (`https://thumbs.odycdn.com/upload`) from
`ui/component/selectAsset/view.tsx`, using multipart data. Legacy claim
metadata contains thumbnail URLs, and channel metadata uses `thumbnail` and
`cover`. A thumbnail on a channel is an avatar, not a video thumbnail.

This checkout currently unwraps `thumbnails.odycdn.com/.../plain/<source>` and
renders remote legacy images directly. That is compatibility rendering, not
migration or independent availability. The Chainquery export in
`scripts/import-chainquery-meili.mjs` contains an immutable outpoint and
`thumbnail_url`, but no channel cover/banner field. A search-only export cannot
establish complete banner coverage; obtain full channel records separately.

A verified historical claim can prove the referenced URL without proving the
bytes currently fetched there. Capture provenance must distinguish a current
URL capture from bytes verified against an independently committed digest.
An importer signature is not the creator's signature or a transfer of ownership.

## Offline pilot inventory

```sh
node --experimental-strip-types scripts/plan-legacy-images.mjs /path/to/claims.json
node --experimental-strip-types --test scripts/plan-legacy-images.test.mjs
```

Input is a JSON array of resolved claim records (`txid`, `nout`, `value_type`,
`value.thumbnail.url`, `value.cover.url`, optional `signing_channel`) or current
Chainquery-style documents (`legacy_outpoint`, `claim_type`, `thumbnail_url`).
This pilot reads the array in memory; it is not a whole-corpus streaming tool.

Output is an offline JSON plan with stable job IDs, source URLs, image roles,
immutable outpoints, source-host counts and explicit issues. Duplicate jobs
collapse, but different historical versions are not merged by URL. Optimizer
URLs are unwrapped. Missing outpoints and URLs with credentials, queries or
fragments require review; their raw URLs are not copied into issue reports.
Use public exports, not raw account records or credential-bearing URLs.

The tool does **not** fetch images, verify claims, assert source availability,
write images, attach metadata, or mark anything migrated. Planned URLs have
not passed DNS/SSRF checks and are not approved fetch targets. Every planned
entry explicitly records `unverified-export-url-only` evidence.

## Capture and staging pilot

`scripts/capture_legacy_images.py` consumes the existing inventory, downloads
explicitly approved public HTTPS images, validates/decode-bounds them and stores
exact originals plus provenance in a resumable private staging directory. It
does not publish, rewrite historical claims or assert creator ownership.
Default mode is offline validation. Capture requires Linux; the supplied pinned
container preserves worker memory limits that macOS refuses to apply.

See the [capture runbook](legacy-image-capture.md) for host approval, bounds,
commands, checkpoint/retry semantics and fixture-vs-production evidence limits.
The importer and security fixtures are separate from the frontend and do not
require a node, search worker, account or custom device.

## Remaining implementation order

1. Run the capture tool on a reviewed small public legacy export with explicitly
   approved hosts. Controlled fixtures are not a production migration rehearsal.
2. Publish via generic signed writes using an explicitly selected migration
   identity. Exact-read and compare bytes before marking a job complete. Keep
   source mappings/provenance separate from creator-authorized metadata.
3. Define who authorizes migration mappings and how stores/integration consume
   them. Test with legacy image hosts unavailable before declaring independence.
4. Add bounded derivatives, operator upload controls and policy enforcement;
   prove replication and restore. A local write receipt is not permanent storage.

## Validation commands and boundaries

`pnpm run test:native-images` covers preflight, decode failures, dimensions,
resource release, ID validation and write retry. Decoder behavior is stubbed
in that contract suite.

`pnpm run test:native-images:browser` uses actual Chromium decoding and both
service adapters against an ephemeral, in-memory loopback HTTP fixture. It
checks PNG/JPEG/WebP/GIF, profile GIF rejection, corrupt/spoofed images, exact
bytes/content types, 503 retry and fresh-reader rendering. It is not a real
HyperBEAM commitment, profile editor or production persistence test.

Run the affected frontend contracts from `odysee-frontend`:

```sh
pnpm run test:native-images
pnpm run test:native-images:browser
pnpm run test:native-profiles
pnpm run test:native-upload-revisions
pnpm run typecheck:tsc
pnpm run check
```

A reduced-homepage bundle is not canonical homepage acceptance. Real browser
flows, replication and production migration require their own fixtures and
operator setup; contract passes do not close those gates.
