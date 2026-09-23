# Image storage and migration

## First slice — 2026-09-22

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

The shared uploader returns both ID and URL, but native upload metadata still
uses `thumbnail-url`. Moving new thumbnail references to an explicit immutable
ID with backward-compatible hydration/search/revision support remains open.
Do not silently reinterpret arbitrary remote 43-character URL paths as native
image IDs or mutate existing immutable snapshots.

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

## Remaining implementation order

1. Verify full thumbnail/avatar/banner editor lifecycles on an isolated node:
   save, refresh, replace, clear, failed-save retry, fresh viewer, foreign/stale
   revisions and exact historical snapshots. Existing profile/upload revision
   specs provide the starting point; this slice does not newly certify them.
2. Add portable native thumbnail-ID metadata with old URL compatibility through
   the shared hydration/revision/search boundary. No page-specific rewriting.
3. Build a bounded capture/staging importer: approved hosts, DNS/IP checks on
   every connection/redirect, timeout/byte/decode limits, content hash, capture
   time, source outpoint, safe checkpointing and explicit failed/missing states.
4. Publish via generic signed writes using an explicitly selected migration
   identity. Exact-read and compare bytes before marking a job complete. Keep
   source mappings/provenance separate from creator-authorized metadata.
5. Define who authorizes migration mappings and how stores/integration consume
   them. Test with legacy image hosts unavailable before declaring independence.
6. Add bounded derivatives, operator upload controls and policy enforcement;
   prove replication and restore. A local write receipt is not permanent storage.

No production exports or images were imported. No shared node/search services
were changed. Existing unrelated QA and authentication research edits remain.

## Validation

`pnpm run test:native-images` covers preflight, decode failures, dimensions,
resource release, ID validation and write retry. Decoder behavior is stubbed
in that contract suite.

`pnpm run test:native-images:browser` uses actual Chromium decoding and both
service adapters against an ephemeral, in-memory loopback HTTP fixture. It
checks PNG/JPEG/WebP/GIF, profile GIF rejection, corrupt/spoofed images, exact
bytes/content types, 503 retry and fresh-reader rendering. It is not a real
HyperBEAM commitment, profile editor or production persistence test.

All 14 frontend contract commands (images, profiles, upload revisions, comments,
message verification, session/cache, controls, reactions, playlists,
subscriptions, preferences, notifications, homepage and static manifest) pass;
the offline inventory's four tests pass. TypeScript and formatting/lint pass
(six existing unrelated lint warnings). The standalone static frontend bundle
also compiles, without regenerating local-content selections. The canonical
`build:manifest` is blocked at local-content materialization because configured
node `127.0.0.1:18801` refuses connections. No live cookie lifecycle, full editor
acceptance, backend tests or production migration is claimed.
