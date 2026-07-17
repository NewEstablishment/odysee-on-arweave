# Serving the Odysee frontend as a static SPA from a HyperBEAM node

The production build in `web/dist/public/` is a fully static SPA that can be
served from an arbitrary, build-time-unknown subpath — specifically from a
HyperBEAM node via the Arweave path-manifest device at:

```
GET /<ManifestID>              -> manifest index.html
GET /<ManifestID>/<asset-path> -> manifest asset
```

where `<ManifestID>` is a 43-character base64url transaction ID. The manifest
device falls back to `index.html` for a missing FIRST path segment under the
manifest (SPA fallback), but 404s for a missing file inside an EXISTING
manifest folder — so every asset request must hit a real manifest path.

## How to build

```sh
cd frontend
pnpm install          # once
NODE_ENV=production pnpm build
```

Output: `web/dist/public/`. Upload that directory as an Arweave path manifest
(with `index.html` as the manifest index) and serve it from a HyperBEAM node.
No server code is required at runtime; everything under `web/` (the Koa
server) is optional enhancement (see below).

## What changed and why

- **`vite.config.ts` — `base: './'` for builds** (dev server keeps `/`).
  All emitted asset references in `index.html` (`./assets/…`, `./font/…`,
  `./img/…`, the inline `@font-face` urls) and all `url(...)` references in
  emitted CSS (`../img/…`, `./<hashed-asset>`) are relative, so they resolve
  under any prefix. JS-internal chunk/worker URLs are resolved against
  `import.meta.url`, which is prefix-independent by construction.

- **`index.html` — runtime `<base>` bootstrap.** Relative URLs alone break on
  deep links (`/<ID>/@channel/video` would resolve `./assets/…` against the
  deep path and 404). A tiny inline script at the top of `<head>` matches a
  43-char base64url first path segment and injects `<base href="/<ID>/">`
  before any asset reference is parsed. When no manifest ID is present the
  script is a no-op and relative URLs resolve against the page URL (root
  serving). Keep its regex in sync with `ui/util/manifest-prefix.ts`.

- **`ui/util/manifest-prefix.ts` (new).** Runtime detection of the serving
  prefix from `location.pathname`, computed once at module load.
  `manifestPrefix()` returns `'/<ID>'` or `''`; `isServedFromManifest()` is
  the boolean form.

- **`ui/index.tsx` — `<BrowserRouter basename={manifestPrefix() || '/'}>`.**
  See "Routing decision" below.

- **`ui/util/hyperbeam.ts` — `hyperbeamBaseUrl()` same-origin default.**
  When served from a manifest the node serving the app is the node to talk
  to, so the HyperBEAM base URL defaults to `window.location.origin`.
  Precedence: explicit `HYPERBEAM_BASE_URL` config → same-origin (manifest
  serving) → `ODYSEE_HYPERBEAM_NODE_API`. The `odysee-hyperbeam-mode`
  localStorage switch continues to work unchanged.

- **`web/src/push-notifications/push-supported.ts` — push disabled under
  manifest serving.** There is no origin-root `/sw.js` to register on a
  HyperBEAM node, so `isPushSupported()` returns false and no service worker
  registration is ever attempted (verified: zero SW registrations, zero
  `/sw.js` requests).

- **`ui/redux/actions/settings.ts` — `doFetchHomepages` guard.** The homepage
  JSON endpoint (`/$/api/content/v2/get`) is a Koa route that does not exist
  under manifest serving; the action dispatches `FETCH_HOMEPAGES_FAILED`
  directly instead of fetching, keeping the console clean.

- **`ui/effects/use-get-poster.ts`** — the static poster placeholder is
  prefixed with `manifestPrefix()` so it hits a real manifest path.

- **`vite.config.ts` — `ssrTemplatePlugin` rebases tags for Koa.** The tags
  copied into `index-web.html` (the Koa/SSR template) are rewritten from the
  relative `./assets/…` form back to the absolute `/public/assets/…` form the
  Koa server serves, so the enhanced deployment is unaffected by the relative
  base. The legacy-browser fallback loader in both HTML files computes the
  manifest prefix itself (it runs before the `<base>` bootstrap).

## Routing decision and tradeoff

**Chosen: history routing with a runtime `basename`** derived from the first
path segment when it looks like a 43-char base64url ID (`manifestPrefix()`),
combined with the runtime `<base>` tag for asset resolution.

- Deep links work because the manifest device falls back to `index.html` for
  any missing first segment under the manifest (`/<ID>/@channel/video` →
  `@channel` is not a manifest folder → index.html), and the `<base>` tag
  then anchors asset requests to real manifest paths, avoiding the
  nested-404 gotcha.
- Client navigation stays under `/<ID>/…` because React Router prepends the
  basename to every link and navigation (verified in-browser).
- URLs remain canonical-looking and shareable, unlike hash routing
  (`/<ID>#/@channel/video`), which was the fallback option. Hash routing was
  rejected because the manifest fallback semantics make history routing work
  with no server cooperation, and hash URLs would diverge from the rest of
  the Odysee ecosystem (share links, SEO, embed paths).

Tradeoffs / accepted edge cases:

- A root claim name that is exactly 43 chars of `[A-Za-z0-9_-]` would be
  misdetected as a manifest ID when the app is NOT served from a manifest.
  Claim names of that shape are vanishingly rare and the check only triggers
  on the first path segment.
- A handful of flows use raw `window.location.assign('/…')` (auth redirects,
  collections) and would drop the prefix; those flows depend on the Koa
  server/backends and are enhancement-only anyway.
- The favicon swap for notification badges uses the absolute
  `/public/favicon_*.png` config constants and silently no-ops under
  manifest serving (cosmetic).

## What remains served-by-enhancement only (Koa `web/` server)

The static bundle boots and runs without any of these; they light up only
when the app is served by the Koa server in `web/`:

- SSR meta/OG/oEmbed/RSS endpoints and the `index-web.html` template.
- `/$/api/*` routes: homepage content (`content/v2/get`), auth-token
  bridging, HyperBEAM upload/thumbnail write proxies (`hyperbeam-upload`,
  `hyperbeam-thumbnail`, `hyperbeam-auth-device`). Signed-in account
  features and native-message writes route through these proxies.
- `/sw.js` service worker + Firebase push notifications.
- `/$/minVersion/v1/get` version nag (fetched from the configured `URL`
  origin; failure is caught and ignored).

## Local subpath verification

A server mimicking the manifest semantics (first-segment fallback, nested
404) lives in the session scratchpad (`manifest-serve/serve.py`). Steps:

```sh
NODE_ENV=production pnpm build
ID=FakeManifestID_xxxxxxxxxxxxxxxxxxxxxxxxxxxx   # any 43-char base64url name
mkdir -p /tmp/manifest-root/$ID
cp -R web/dist/public/ /tmp/manifest-root/$ID/
python3 serve.py /tmp/manifest-root 8917
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/$ID            # 200 index.html
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/$ID/assets/index-<hash>.js  # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/$ID/font/v1/400.woff        # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/$ID/img/busy.gif            # 200 (CSS ../img ref)
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/$ID/assets/nope.js          # 404 (nested, no fallback)
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/$ID/@chan/video             # 200 index.html (fallback)
```

In-browser: the app boots at `/<ID>/`, deep links (`/$/settings`,
`/@channel/video`) render fully styled, every asset request resolves under
the prefix, HyperBEAM device calls go to the serving origin root
(`/~odysee-claim@1.0/…`), and the console is free of errors.
