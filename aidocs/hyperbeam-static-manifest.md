# HyperBEAM Static Manifest Operations

## Purpose

The static-manifest mode packages the current Odysee frontend so a HyperBEAM
node can serve it from an Arweave path manifest. It is optional. The normal
Koa/SSR build remains the default deployment and is not replaced by this mode.

Manifest URLs have this shape:

```text
http://node.example/<manifest-id>
```

The 43-character manifest ID is also the runtime path prefix. The frontend
uses hash routing in this mode so deep links never depend on server-side SPA
fallback behavior.

## Build

From `odysee-frontend/`:

```sh
pnpm install
pnpm run build:manifest
```

The command builds `web/dist/public/` and then verifies that:

- `index.html` contains the manifest-prefix bootstrap;
- local assets use relative URLs;
- emitted filenames avoid HyperBEAM-reserved path characters;
- CSS contains no root-relative local asset URLs;
- `index-web.html` remains suitable for the normal Koa/SSR server.

The same checks can be run independently:

```sh
pnpm run test:static-manifest
node build/check-static-manifest.mjs
```

## Publish

Set the node URL and, when the node requires it, an Odysee auth token:

```sh
export HYPERBEAM_BASE_URL=http://127.0.0.1:10000
export ODYSEE_AUTH_TOKEN=<token>
pnpm run publish:manifest
```

Optional arguments follow `--`:

```sh
pnpm run publish:manifest -- --concurrency 4
pnpm run publish:manifest -- --node https://node.example --dir web/dist/public
```

The publisher writes each file through the generic signed HyperBEAM ID route,
builds an `application/x.arweave-manifest+json` path manifest from the returned
message IDs, writes that manifest through the same route, and reads the
published root back. Publication fails if the returned root does not exactly
match the built `index.html`.

Do not use `--no-verify` for a release. It exists only for diagnosing a node
that cannot yet serve path manifests.

## Runtime Behavior

- A manifest-served build uses `HashRouter`; normal deployments use
  `BrowserRouter`.
- An explicit `HYPERBEAM_BASE_URL` wins. Otherwise a manifest-served build
  talks to the serving origin.
- Push notifications are disabled because a manifest cannot install the
  origin-root service worker.
- The Koa homepage endpoint is skipped and built-in homepage data is used.
- Authenticated features that require Koa proxy routes remain enhanced-server
  features unless the serving node exposes equivalent authenticated routes.
- Direct media and immutable object reads still target the HyperBEAM node;
  legacy and protected-content fallbacks remain part of the normal product
  deployment.

## Release Gate

Before publishing a manifest release:

1. Run `pnpm run typecheck:tsc`.
2. Run `pnpm run test:static-manifest`.
3. Run `pnpm run build:manifest`.
4. Publish with verification enabled.
5. Open the printed manifest URL and a hash deep link.
6. Confirm that assets, immutable reads, playback, and expected anonymous
   navigation work from the manifest origin.
7. Confirm separately that `pnpm run build` still produces the normal SSR
   assets and that the Koa server still boots from `index-web.html`.

The manifest build is not a reason to remove SSR routes, authenticated
proxies, or compatibility devices. Those can only be removed after an
equivalent generic node contract is deployed and independently verified.
