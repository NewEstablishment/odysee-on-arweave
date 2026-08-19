# `~search@1.0` — generic full-text search for HyperBEAM

A generic full-text indexer and query device for HyperBEAM messages.
It is not Odysee-specific: it indexes whatever fields a written message
carries, and answers full-text queries with BM25-ranked message IDs.
Engine and rationale: [decisions/search-engine.md](../decisions/search-engine.md)
(Meilisearch over HTTP).

## Shape

Two parts, mirroring how HyperBEAM separates a store's engine from its
device surface (`hb_store_lmdb` the engine, `~cache@1.0` the surface):

- **`hb_search`** — a plain OTP module owning the backend connection. A
  singleton `gen_server` serializes indexing off the caller's write path
  (asynchronous `cast`) and answers queries synchronously. The backend is
  Meilisearch at the node option `search-backend-url` (default
  `http://127.0.0.1:7700`), index `search-index` (default
  `hyperbeam_messages`), optional `search-api-key`.
- **`~search@1.0`** — the thin device. Its `query` key runs a Meilisearch
  search and returns matching message IDs, ranked by relevance — the same
  "return paths" contract `~query@1.0` uses, so callers hydrate hits with
  `~cache@1.0/read`.

## Indexing: the write hook

Indexing is driven by the generic `cache-write` hook: `hb_cache` fires
`on/cache-write` after every top-level write, passing the message under
`body`. A node enables search by registering the device as the handler:

```erlang
<<"on">> => #{
    <<"cache-write">> =>
        [#{ <<"device">> => <<"search@1.0">>, <<"path">> => <<"write">> }]
}
```

The handler derives the message id, extracts indexable fields and casts
them to the `hb_search` server, returning the request unchanged. Indexing
is asynchronous and failure-tolerant, so it never blocks, fails, or
recurses on the write path.

**Every** cache write reaches this hook — sub-messages, evidence
fragments, and (on a node that publishes its UI) each static asset. The
`search-index-markers` option names fields that mark a message as a
document; only matching messages are indexed. The empty default indexes
everything, which is rarely what an operator wants; the Odysee node sets
`[schema, claim-name]`.

## Schema

- **Default (no config): index every scalar string field** of the
  message. Values are concatenated into a `content` attribute for
  matching, and each selected field is also stored under its own
  attribute for filtering. Non-indexable values (binary payloads,
  submessages, `commitments`, `priv`, identifier-shaped strings) are
  skipped.

- **`search-schema` node option (optional):** a list of field names. When
  present, only those fields are indexed. Ranking weights and tokenizer
  settings are Meilisearch index settings, configured on the instance
  rather than through the device.

  case- and accent-folding).

## Query

`GET /~search@1.0/query?q=<terms>&limit=<n>&fields=<a,b>` →

1. Run `SELECT id, bm25(docs, <weights>) AS rank FROM docs WHERE docs
   MATCH ? ORDER BY rank LIMIT ?` with the query string.
2. Return the ranked list of message IDs (default `return=paths`, like
   `~query@1.0`), or the hydrated messages (`return=messages`).

For application ranking that blends relevance with non-text signals
(recency, views, channel weight — the Odysee model), configure the index's
ranking rules on the Meilisearch side; the device stays generic and
returns whatever order the backend ranks.

## Scale

Sized for the existing Odysee corpus (~35M records). Bulk import runs
outside the write hook against Meilisearch directly; the hook handles
steady-state deltas only.

