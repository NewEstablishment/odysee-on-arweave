# Native Auth Upload Convergence Plan

Source: latest team transcript provided on 2026-06-29.

Interpretation rule: Sam's statements are treated as the definite product/architecture direction. Other transcript comments are implementation context, constraints, demos, or open questions unless Sam's direction explicitly adopts them.

## Goal

Converge on a demo where Odysee can upload content through normal HyperBEAM auth, store it as signed HyperBEAM data, read it back by ID, and show it in the UI beside legacy content.

The important shift is to prefer generic HyperBEAM behavior over Odysee-specific custom devices wherever possible:

- use the default `on.request` auth hook path;
- make cookie auth work like HTTP Basic auth currently works;
- upload through a normal signed `POST /<id-or-store-path>?!` style flow;
- let the store stack decide whether an ID resolves from local HyperBEAM storage, remote/community storage, or legacy Odysee backing stores;
- keep Odysee-specific devices only where computation or legacy protocol translation is actually needed.

## Current Understanding

Public reads mostly work. The remaining product gap is authenticated writes and the ability to discover/query new HyperBEAM-native content alongside legacy Odysee content.

Auth currently works through Odysee-specific authenticated device paths, with a same-origin frontend bridge for localhost because the `auth_token` cookie belongs to `odysee.com`, not `127.0.0.1`. In production, the intended model is for Odysee and HyperBEAM to share an origin so the browser can send the cookie directly.

Sam's preferred direction is narrower and more native:

- configure the existing HyperBEAM auth hook to use cookies, not only HTTP Basic;
- use that hook to sign and store writes without custom Odysee upload devices in the critical path;
- read all content through generic `GET /<id>` store resolution;
- rely on store fallthrough rather than frontend/device branching between "legacy" and "new" content.

## Monday Convergence Target

By the next convergence point, demonstrate this loop:

1. A browser/user has an auth credential available, initially by manually setting or bridging the existing Odysee `auth_token`.
2. The request reaches HyperBEAM with `?!` or equivalent auth-hook activation.
3. HyperBEAM derives/loads the signing secret through cookie auth.
4. The upload is signed by the normal auth path and written to the configured store.
5. HyperBEAM returns an ID for the stored signed data.
6. `GET /<id>` returns that uploaded data from the store.
7. The UI can render that new uploaded item.
8. The same UI path can still render legacy content by ID through store fallthrough.

## Checklist

- [x] Map the default HyperBEAM `on.request` auth hook path end to end.
- [x] Confirm the current `?!` + auth-hook path signs and stores a minimal payload.
- [x] Confirm the default config already routes Odysee token fields to `odysee-auth@1.0`.
- [x] Prove HyperBEAM can extract the Odysee `auth_token` cookie value from the normalized request.
- [x] For localhost, keep the same-origin frontend bridge or manual cookie injection as a demo shim.
- [x] For production notes, document that same-origin deployment removes the local bridge requirement.
- [x] Build the smallest signed upload proof on the current `odysee-upload@1.0` write path with auth-hook signing.
- [x] POST a small media fixture through the native auth path.
- [x] Verify the response returns a stable ID.
- [x] Verify `~cache@1.0/read?read=<id>` retrieves the uploaded bytes or message.
- [x] Route the local frontend upload media reader through `~cache@1.0/read?read=<id>` for native manifests and chunks.
- [x] Verify the returned object can be rendered in the frontend with a live browser smoke test.
- [x] Route frontend reads for new native upload media through HyperBEAM cache resolution where practical.
- [x] Make the default store order explicit: primary local store first, then local fs cache, Arweave store, gateway stores.
- [x] Confirm 40-byte claim IDs still resolve through the current legacy device path after the byte-size checker change.
- [x] Identify which existing custom Odysee devices are still needed for computation or legacy translation.
- [x] Stop routing through custom devices where a generic store read/write is enough for native upload media.
- [x] Keep the existing Odysee-authenticated device bridge as a fallback only until the native path works.
- [x] Record remaining cases where the legacy API is still required.
- [x] Add a minimal regression curl recipe for the signed upload/readback loop.
- [x] Add a minimal frontend smoke path for rendering one native upload and indexing/listing it as a channel item.
- [x] Add a minimal generic-store smoke path for one legacy item by raw 40-byte claim ID.

## Execution Status

The upload/read/render half of the convergence plan is executed. The frontend upload route now reads native upload manifests and chunks through `~cache@1.0/read?read=<id>`, which is the same route proven by the HyperBEAM device test and the local web smoke.

The legacy generic-read gap has also been closed for the first claim-ID case. `hb_store_odysee` is now in the default store list after local stores and before Arweave/gateway stores. Its native-path classifier maps 40-byte hex IDs to `odysee/claim-id/<id>`, and the live check returned the Veritasium claim through `~cache@1.0/read?read=346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169`.

The current `~odysee-upload@1.0` device is still required for this demo. Generic `~cache@1.0/write` only accepts trusted cache writers configured on the node, while the Odysee upload path accepts a browser auth token through the auth hook, derives a stable owner identity, strips auth fields before persistence, supports chunk/finalize, and maintains a small per-owner upload index/list surface. Removing it safely requires a generic user-writable signed upload route with equivalent ownership and indexing semantics.

## Validation Notes

Checked on 2026-06-29 from `rave/auth-upload`.

Passing focused command:

```sh
HOME=/tmp/odysee-hb-home HB_PORT=18769 rebar3 device test --devices dev_odysee_auth,dev_odysee_upload --timeout 30
```

Result: all 6 focused tests passed. This covers Odysee auth-token extraction from cookie/header, missing-token challenge behavior, deterministic signer derivation for the same token, upload write auth enforcement, signed upload write, ID return, cache readback, and confirmation that `auth_token` / `x-odysee-auth-token` are not stored in the uploaded object.

Odysee store focused command:

```sh
HOME=/tmp/odysee-hb-home rebar3 eunit -m hb_store_odysee
```

Result: all 8 focused store tests passed. This covers bare SHA-384 blob reads, bare transaction reads, bare claim ID normalization/readback, direct transaction/outpoint reads, and HTTP signature exposure for native blob/transaction reads.

Broader command:

```sh
HOME=/tmp/odysee-hb-home HB_PORT=18770 rebar3 device test --devices dev_auth_hook,dev_odysee_auth,dev_odysee_upload,dev_cache --timeout 30
```

Result: 12 passed, 1 failed. The failure is `auth-hook@1.0:chained_preprocess_test`, which returns a relay/meta 500 with `{badmatch,false}` while resolving `/~meta@1.0/info/address`. The Odysee auth, upload, cache, and other auth-hook tests pass in that broader run.

Frontend route validation:

```sh
node --check odysee-frontend/web/src/routes.js
pnpm run check
```

Result: `routes.js` syntax passed. `pnpm run check` passed with 0 errors and 6 existing lint warnings in livestream-related files outside the upload/readback changes.

Local web smoke validation:

```sh
HOME=/tmp/odysee-hb-home HB_PORT=18780 rebar3 shell
HYPERBEAM_BASE_URL=http://127.0.0.1:18780 ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18780 WEB_SERVER_PORT=13379 pnpm run dev:web-server

curl -i -sS -X POST 'http://127.0.0.1:13379/$/api/hyperbeam-upload/v1/write' \
  -H 'Cookie: auth_token=odysee-smoke-token' \
  -H 'Content-Type: text/plain' \
  --data-binary 'hello smoke upload'

curl -i -sS 'http://127.0.0.1:13379/$/api/hyperbeam-upload/v1/read/<returned-id>'

curl -i -sS -X POST 'http://127.0.0.1:13379/$/api/hyperbeam-upload/v1/large' \
  -H 'Cookie: auth_token=odysee-smoke-token' \
  -H 'Content-Type: text/plain' \
  -H 'X-Odysee-Filename: smoke.txt' \
  --data-binary 'hello large smoke upload'

curl -i -sS 'http://127.0.0.1:13379/$/api/hyperbeam-upload/v1/read/<returned-manifest-id>'
```

Result: both `/write` and `/large` returned 200 with HyperBEAM IDs. The local read route returned the original text bodies. The `/large` readback streamed the chunked manifest content with `Content-Type: text/plain`, `X-Odysee-Hyperbeam-Upload-Id`, and `X-Odysee-Hyperbeam-Chunk-Count`.

Reusable frontend smoke:

```sh
cd odysee-frontend
BASE_URL=http://127.0.0.1:13380 PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium pnpm run test:hyperbeam-upload-smoke
```

Result: passed. The script uploaded an SVG through `/large`, read it through `/read/<id>`, indexed the synthetic claim, confirmed `/list` returned it, opened the read URL in Chromium, found one rendered SVG, and wrote a nonblank screenshot to `/tmp/odysee-hb-upload-smoke.png`.

Legacy path check:

- `~odysee-claim@1.0/resolve` resolves the known 40-byte claim ID fixture when called with the full URI or a `claim_ids` POST.
- `~cache@1.0/read?read=<raw-40-byte-claim-id>` now returns the signed Odysee claim message through store fallback.
- `~cache@1.0/read?read=odysee/claim-id/<id>` also returns the same signed claim message.
- `hb_store_odysee` remains a read-only store wrapper. Its canonical read API is keyed by paths such as `odysee/claim-id/<id>`, `odysee/stream-id/<id>`, `odysee/channel-id/<id>`, and `odysee/comment-id/<id>`, with 40-byte raw claim IDs normalized into the claim-id path.

Live generic legacy read command:

```sh
curl -i -sS 'http://127.0.0.1:18783/~cache@1.0/read?read=346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169'
```

Result: 200 with `device: odysee-claim@1.0`, `claim-id: 346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169`, `claim-store-path: odysee/claim-id/346c1fed0fbc2f0b3ecc8bf3915aa8aaa029c169`, and `canonical-url: lbry://@veritasium#f/why-is-it-so-easy-to-disrupt-gps#3`.

Store order from `hyperbeam/src/core/resolver/hb_opts.erl`:

1. default primary LMDB store;
2. `cache-mainnet` filesystem store;
3. `hb_store_odysee` read-only legacy Odysee store;
4. Arweave store with the primary store as index;
5. AO-filtered gateway store with the primary store as local cache;
6. generic gateway store with the primary store as local cache.

This keeps local/native HyperBEAM storage first and legacy Odysee fallback before broader network gateways.

## Branch Work To Compare

Use the freshest branches from `NewEstablishment/odysee-on-arweave`, not the older `references/` snapshots, when comparing implementation ideas:

- `rave/auth-upload` at `6211ae3`: newest branch; current local branch; contains upload fixes and frontend route work.
- `bhavyagor/auth-upload` at `0001660`: closest alternate; useful for user state, upload bridge, and route bridge work.
- `codex/hyperbeam-auth-experiments` at `307ed9e`: useful for auth/upload demos and scripts.

## Open Questions

- Can cookie auth be wired into the default auth hook without keeping Odysee-specific authenticated devices in the write path?
- What exact request path should be used for generic signed uploads: direct `POST /<id>?!`, a store-specific path, or another native HyperBEAM write route?
- Does the current store stack write large binary bodies directly, or does it need a small store-routing tweak for large uploads?
- Should new uploads store one native media object, larger chunks, Arweave-aligned chunks, or legacy LBRY-style 2 MiB blobs?
- How should range requests work for native media before full end-user verification is available?
- Which query/index surface is needed first: channel uploads, homepage sections, tags, search, or recommendations?
- Can channel pages stitch legacy and native IDs in the UI temporarily while store-backed query catches up?
- Which user-private fields must stay outside public HyperBEAM state, especially email and account metadata?
- How should legacy SDK wallets be imported or associated with auth tokens for existing users?
- What is the new-user identity path: anonymous generated key, Arweave wallet, imported LBRY wallet, or node-hosted wallet?

## Deferred Work

Query and indexing are the main deferred architectural problem. The short-term UI can stitch legacy query results with native uploaded IDs. The longer-term path is to make store-backed matching/querying good enough that channel pages, homepage sections, and search can discover both legacy cached data and new HyperBEAM-native data.

Chunking and media verification are also deferred past the first demo. For the demo, use small files first. Larger media can be handled later with store range parameters, Arweave chunk-tree alignment, or another chunk format that avoids carrying forward the legacy 2 MiB LBRY blob overhead unless compatibility requires it.

## Success Criteria

The convergence work is successful when a developer can:

1. start the local HyperBEAM and frontend stack;
2. provide an auth token through the local demo path;
3. upload a small file through the UI or a documented curl recipe;
4. receive a HyperBEAM ID;
5. fetch that ID back through `GET /<id>`;
6. see the item rendered in the UI;
7. see legacy content still render through the same general read path.
