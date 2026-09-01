# Odysee on HyperBEAM demo

This is the presentation runbook for the store-first Odysee prototype. The
product frontend is a static Arweave path manifest served directly by the same
HyperBEAM node that owns cookie identity, immutable reads, generic writes,
query, search, and playback. The SSR server is not part of the demo path.

## The story to tell

The shortest useful description is:

> Odysee now runs as a static manifest on HyperBEAM. Historical LBRY content
> enters through verifying source stores, while new accounts, uploads,
> comments, reactions, playlists, follows, moderation, and encrypted settings
> are signed append-only messages. Playback analytics use the generic native
> analytics device. Discovery returns immutable locators and the UI hydrates
> exact objects separately.

The architectural points worth emphasizing are:

- The browser has one product data route: the manifest's HyperBEAM origin.
- Native writes use the generic `/id?0.%21=true&committers=all` path; product
  schemas are messages, not a fleet of product write devices.
- The node's `secret-*` cookie is the account authority. Email, password, and
  legacy verified-email state are not required.
- Search and query only discover locators. Exact committed messages remain the
  source of truth.
- Preferences are AES-256-GCM ciphertext at rest. A narrow authenticated
  device seals and opens them, while generic immutable snapshots and
  `reference@1.0` provide append-only history and stable identity.
- Historical transactions, claim outputs, descriptors, and blobs are checked
  against their native hashes before they are cached or served.
- Page activity, playback engagement, and public view totals use
  `analytics@1.0`; the browser does not call legacy Watchman or view-count
  services.

## Presentation preflight

Do this before the audience arrives. The checked-in demo configuration allows
10,000 requests/minute per IP so the roughly 1,000-asset cold manifest load does
not exhaust the stock bucket. Avoid unnecessary refresh loops all the same.

Package the runtime once after a pull or any device change. Playlists use the
external reference device; private-playlist cryptography stays in the browser:

```sh
HB_PORT=18734 rebar3 device preload \
  --device-src src,_build/default/lib/reference_1_0/src \
  --output-dir _build/device-local-store \
  --verbose
```

```sh
# Terminal 1: Meilisearch. Use the already-populated demo database.
../meilisearch/target/release/meilisearch \
  --http-addr 127.0.0.1:7700 \
  --db-path /tmp/odysee-meili-data

# Terminal 2: HyperBEAM. Keep the persistent store so the demo identity,
# uploads, comments, preferences, and published manifest survive restarts.
HB_CONFIG=config.json \
HB_PRELOADED_STORE=_build/device-local-store \
rebar3 shell

# Terminal 3: only when a fresh manifest is required.
cd odysee-frontend
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 \
pnpm run publish:manifest
```

Copy the printed manifest ID into the ignored root `.demo-manifest` file. The
presentation URL is:

```text
http://127.0.0.1:18801/<MANIFEST-ID>/#/
```

Confirm the stack and published entry page:

```sh
curl http://127.0.0.1:7700/health
curl -I http://127.0.0.1:18801/~meta@1.0/info
curl -I "http://127.0.0.1:18801/$(tr -d '\n' < .demo-manifest)/"
```

Open the manifest once, verify that the homepage tiles appear, and leave that
tab open. Have one short MP4 ready if you want to perform a fresh upload.

## Recommended eight-minute walkthrough

### 1. Start with the manifest homepage

Open the manifest root. Show the materialized **Local content** section and
open its sidebar category. Change sort or grid/list display, then click a tile.

What to say: the homepage was built from ranked `search@1.0` locators and each
locator was exact-read before it entered the bundle. Meilisearch discovers;
it does not supply authoritative objects.

### 2. Show playback as a normal browser experience

Play the selected video, seek forward and backward, and enter/exit fullscreen.
Point out the displayed view total. If you want to demonstrate a new qualified
view, use media longer than 30 seconds and keep it actively playing beyond the
configured threshold before refreshing the count.

What to say: immutable native media and verified historical media support
single HTTP byte ranges, so browser seeking receives `206 Partial Content`.
The partial response is a delivery representation; the whole immutable object
remains the commitment-verification surface. The view total combines an
owner-imported historical baseline with qualified, deduplicated native
`analytics@1.0` engagement.

### 3. Show the cookie-native account and channel

Open **Channels**, then open **My channel page**. Point out the banner, avatar,
tabs, owner edit controls, upload count, and channel-attributed tiles.

What to say: the hosted cookie wallet, not local storage or a claimed profile
field, is the authority. The exact profile message is verified under that same
committer and normalized into the legacy-compatible UI shape at one frontend
boundary.

### 4. Publish under the native channel

Open the upload wizard. Show that the native channel is already selected,
choose a short MP4, set a unique slug and title, review the summary, and
publish. If you intentionally reuse a name, show the collision warning first.

After publish, open the result and then the channel's **Content** tab.

What to say: the file bytes receive one immutable ID, and a second generic
`odysee-upload@1.0` record links presentation metadata to those bytes. A native
upload takes precedence over a historical name collision without changing
immutable identity.

### 5. Demonstrate append-only social state

On the video:

1. Like it.
2. Add a comment and a reply.
3. Edit the comment if time permits.
4. Use the creator menu to pin or hide a comment.
5. Follow a channel, refresh, then unfollow it.

What to say: every change is another signed message. Ayush's shared
revisioned-message kernel validates contiguous same-owner chains and handles
fork/equivocation policy consistently for comments, controls, reactions,
playlists, and subscriptions.

### 6. Show an encrypted private playlist

Add the video to a new playlist. The create confirmation stays busy until the
signed snapshot and stable reference are saved; there is no separate Publish
button. New playlists are private by default: show the lock badge and absence
of Share, refresh, then reorder or change the list and press Save. The route
stays `/$/playlist/<reference-id>` and the decrypted contents survive refresh.

Open Edit, select **Make this playlist public**, press Save, and accept the
irreversible confirmation. The same route now shows Public and enables Share.

What to say: each playlist version is a full immutable snapshot. The canonical
`reference@1.0` init commitment is the stable ID, and authorized set messages
advance its head without mutating history. Private versions contain only
a WeaveMail-format envelope: browser WebCrypto creates a fresh AES key and
wraps it to a non-exportable RSA key stored in IndexedDB for the signed-in
native owner. The node only receives ciphertext and generic reference writes;
there is no playlist crypto device. Save is the committed write, and conversion
to public is one-way because public history cannot be hidden later.

### 7. Finish with encrypted preferences

Open Settings, change theme or language, leave Settings so the save completes,
then refresh the manifest. The chosen values should already be present before
re-entering Settings.

What to say: preferences hydrate during application startup. Public storage
contains only IV, ciphertext, authentication tag, owner, and algorithm
metadata; plaintext exists only at the authenticated seal/open boundary.

### 8. Optional network proof

In browser developer tools, filter the Network panel for:

```text
api.na-backend.odysee.com
api.odysee.live
comments.odysee.tv
watchman.na-backend.odysee.com
thumbnails.odycdn.com
```

Normal native navigation, publish, playback, settings, and social flows should
show no product requests to those hosts. The manifest, reads, writes, queries,
and ranges should target `127.0.0.1:18801`.

## Validation before a demo build

```sh
rebar3 compile
rebar3 eunit-all
node --test scripts/export-legacy-analytics-baseline.test.mjs \
  scripts/import-analytics-baseline.test.mjs

cd odysee-frontend
pnpm run fmt:check
pnpm run typecheck:tsc
pnpm run check
pnpm run test:native-comment-revisions
pnpm run test:native-message-verification
pnpm run test:native-comment-controls
pnpm run test:native-reactions
pnpm run test:native-playlists
pnpm run test:native-subscriptions
pnpm run test:native-preferences
pnpm run test:manifest-homepage
pnpm run test:static-manifest
```

Live cookie lifecycle tests use the running node:

```sh
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-comments
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-reactions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-playlists
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-subscriptions
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:native-cookie-preferences
HYPERBEAM_BASE_URL=http://127.0.0.1:18801 pnpm run test:hyperbeam-upload-smoke
```

## Honest limitations

- View totals are implemented, but the Odysee application does not include an
  analytics dashboard. Historical totals require a one-time owner-signed
  baseline import.
- Native aggregate subscriber counts, moderation delegates, and blocked-word
  settings are not implemented.
- Upload metadata edit/delete still needs a complete append-only contract.
- Browser identity is local to this node/browser and is not yet portable or
  recoverable on another deployment.
- Private-playlist keys are local to browser IndexedDB. There is no backup or
  cross-device recovery yet, so do not clear browser data used for the demo.
- Single HTTP ranges work; multipart byte ranges are not implemented.
- Production deployments must tune the per-IP rate-limit bucket together with
  their static asset delivery and abuse controls; the demo uses 10,000
  requests/minute specifically to accommodate cold manifest loads.
- Homepage/category selections are node-signed HyperBEAM messages. The Odysee
  OTP application publishes an initial snapshot at node startup and installs
  the all-language hourly refresh through stock `cron@1.0`. Keep Meilisearch
  and the configured source stores available when a refresh runs; the previous
  valid snapshot remains readable if a refresh fails.

For the detailed trust and data model, read `README.md`,
`docs/architecture.md`, and `docs/native-messages.md`.
