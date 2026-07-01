# HyperBEAM Demo Goals From June 29 Call

This is the current demo ladder for the June 29 call follow-up.

## Implemented Demo Surfaces

1. Immutable playback

   `~odysee@1.0/media` accepts a legacy immutable outpoint target such as `<txid>:<nout>`. It reads the corresponding claim-output message from the store, derives the stream `sd-hash`, and serves media ranges through the existing media path.

2. Mutable-to-immutable reference

   `~odysee@1.0/reference` accepts either a mutable target, such as a LBRY URI, or an immutable target, such as `<txid>:<nout>`. It returns a demo-friendly reference record with outpoint, claim-proof store path, media path, descriptor path, and range path when those fields are available.

3. Direct store ID

   `~odysee@1.0/source` remains the direct read path for native IDs. The demo manifest now points to it directly, and the query prototype can include a source item when `id` is supplied.

4. Native upload to playback

   Native HyperBEAM upload claims now keep using `~odysee@1.0/media`, and the frontend media helper prefers immutable legacy outpoints when present while preserving native-upload fallbacks.

5. Local query prototype

   `~odysee@1.0/query` is a deliberately narrow local-demo query path. It indexes native upload records from the demo cache roots and can include a direct source lookup. This is not the final search/index device; it is a working demo scaffold until the index schema is finalized.

6. Meilisearch-backed search

`~odysee-search@1.0` can now talk to Meilisearch when `meili-url` is configured. It exposes `health`, `index`, `index-legacy`, and `query` endpoints, and the normal `search` endpoint can use Meilisearch with `meili=true` or node-level `meili-url` config. It falls back to the existing claim-search bridge when Meilisearch is not configured or unavailable.

Indexing uses `id` as the default Meilisearch primary key. This avoids Meilisearch primary-key inference failures when Odysee documents include both `id` and `claimId`.

Legacy indexing uses the existing `~odysee-claim@1.0/search` bridge, which calls the legacy Odysee SDK proxy `claim_search` path and normalizes the returned claim items before indexing them into Meilisearch. By default, `index-legacy` indexes one page; pass `pages` and `max-pages` for small controlled batches.

## Local Demo Commands

Start the local demo node:

```sh
cd hyperbeam
./scripts/odysee-auth-upload-demo.sh
```

The script now prints copyable checks for:

- `~odysee-upload-demo@1.0/upload`
- `~odysee-claim@1.0/search`
- `~odysee@1.0/demo`
- `~odysee@1.0/query`
- `~odysee@1.0/reference`
- `~odysee@1.0/media`

Useful direct checks once a node is running:

```sh
curl -sS 'http://127.0.0.1:18736/~odysee@1.0/demo' | jq .
curl -sS 'http://127.0.0.1:18736/~odysee@1.0/query?q=native&legacy-user-id=424242' | jq .
curl -sS 'http://127.0.0.1:18736/~odysee@1.0/reference?target=<lbry-uri-or-txid:nout>' | jq .
curl -i -sS 'http://127.0.0.1:18736/~odysee@1.0/media?target=<txid:nout>' | sed -n '1,20p'
```

## Meilisearch Demo

Start Meilisearch with Docker and a HyperBEAM node configured to use it:

```sh
cd hyperbeam
USE_SUDO_DOCKER=1 ./scripts/odysee-meili-search-demo.sh
```

The script starts a Docker container from `getmeili/meilisearch:v1.37`, waits for `/health`, then starts HyperBEAM with:

```text
meili-url = http://127.0.0.1:7700
meili-index = odysee_claims
```

Useful checks once it is running:

```sh
curl -sS 'http://127.0.0.1:18744/~odysee-search@1.0/health' | jq .
curl -sS -X POST -H 'content-type: application/json' --data-binary '{"documents":[{"id":"demo-1","claimId":"demo-1","name":"hyperbeam-meili-demo","title":"HyperBEAM Meilisearch Demo","description":"Search indexed through HyperBEAM"}]}' 'http://127.0.0.1:18744/~odysee-search@1.0/index' | jq .
curl -sS -X POST -H 'content-type: application/json' --data-binary '{"query":"s=nature&size=5&claimType=file","pages":1}' 'http://127.0.0.1:18744/~odysee-search@1.0/index-legacy' | jq .
curl -sS 'http://127.0.0.1:18744/~odysee-search@1.0/query?q=hyperbeam&limit=5' | jq .
curl -sS 'http://127.0.0.1:18744/~odysee-search@1.0/query?q=nature&limit=5' | jq .
curl -sS 'http://127.0.0.1:18744/~odysee-search@1.0/search?meili=true&query=s%3Dhyperbeam%26size%3D5' | jq .
```

## Still Not Final

- The production search/index path still needs the agreed schema, write hooks, ranking/filter settings, and backfill plan.
- The reference path currently returns the best available immutable reference record; production name-resolution policy still belongs in the reference-device design.
- Native uploads are stable HyperBEAM content references, not LBRY transaction outpoints.
