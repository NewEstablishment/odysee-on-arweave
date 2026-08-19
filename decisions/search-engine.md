# Decision: `~search@1.0` full-text engine — Meilisearch

**Superseded decision:** this document previously chose SQLite FTS5 via the
`esqlite` NIF (embedded, single-file, no daemon). That choice is reversed:
the engine is Meilisearch, reached over HTTP.

## Why the reversal

- The Odysee corpus and its ranking model (relevance blended with recency,
  views and channel signals, per-group result capping) are what the legacy
  search stack already expresses in Meilisearch; FTS5 would mean rebuilding
  that ranking in Erlang on top of BM25.
- Meilisearch was already the working backend for the imported Chainquery
  corpus, so an index and its tuning exist rather than needing a backfill
  path invented alongside a new engine.
- Team direction (2026-08): keep the search backend as the separately
  operated service and keep the device generic over it.

## Consequences accepted

- A node that indexes needs a Meilisearch instance reachable at
  `search-backend-url`; the terse, no-daemon property that motivated FTS5
  is given up. Nodes that only *serve* need nothing.
- Index availability is now an operational dependency of writes. The
  device is transparent and asynchronous, so an unreachable backend loses
  index updates but never fails or slows a cache write.

## Retained from the FTS5 decision

The device contract is unchanged and engine-agnostic: `write` indexes a
message's selected fields; `query` returns ranked message ids that the
caller hydrates through ordinary reads. Field selection, identifier
filtering, and the schema option live in `hb_search`, not in the engine,
so a future backend swap touches one module.

## Configuration

| Option | Default | Purpose |
| --- | --- | --- |
| `search-backend-url` | `http://127.0.0.1:7700` | Meilisearch base URL. |
| `search-index` | `hyperbeam_messages` | Index name; created on demand with `id` as primary key. |
| `search-api-key` | unset | Bearer key when the instance requires one. |
| `search-schema` | all fields | Restrict indexing to named fields. |
| `search-index-markers` | `[]` (index everything) | Fields that mark a message as a document. The Odysee node sets `[schema, claim-name]`. |
