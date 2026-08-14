# `~search@1.0` — generic full-text search for HyperBEAM

A generic full-text indexer and query device for HyperBEAM messages.
It is not Odysee-specific: it indexes whatever fields a written message
carries, and answers full-text queries with BM25-ranked message IDs.
Engine and rationale: [decisions/search-engine.md](../decisions/search-engine.md)
(SQLite FTS5 via the `esqlite` NIF).

## Shape

Two parts, mirroring how HyperBEAM separates a store's engine from its
device surface (`hb_store_lmdb` the engine, `~cache@1.0` the surface):

- **`hb_search`** — a plain OTP module owning the FTS5 index. A singleton
  `gen_server` holds the single write connection and batches inserts in a
  transaction (as `hb_store_lmdb` does); a pool of read-only WAL
  connections answers queries concurrently. The index DB is one `.db`
  file at the node option `search-db` (default `<data-dir>/search.db`).
- **`~search@1.0`** — the thin device. Its `query` key runs an FTS5
  `MATCH` and returns matching message IDs, ranked by BM25 — the same
  "return paths" contract `~query@1.0` uses, so callers hydrate hits with
  `~cache@1.0/read`.

## Indexing: the write hook

Indexing is driven by the generic `write` hook
(`hb_cache` fires `on/write` after every top-level message write, passing
the message and its id — see the `feat/cache-write-hook` HyperBEAM
branch). A node enables search by registering the device as the handler:

```erlang
<<"on">> => #{ <<"write">> => #{ <<"device">> => <<"search@1.0">> } }
```

On each write the device extracts indexable fields and upserts a row into
FTS5 keyed by the message id. Indexing is asynchronous (a cast to the
`hb_search` server), so it never blocks or recurses on the write path;
the hook already strips itself from the handler's options, so the
server's own bookkeeping writes cannot re-fire it.

## Schema

- **Default (no config): index every scalar string field** of the
  message. The FTS5 table is created with a fixed wide column set the
  first time a field is seen, or — simpler and chosen here — a single
  `content` column holding all field values concatenated, plus a stored
  `fields` JSON for exact per-field filtering. Field names that are not
  indexable (binary blobs, submessages, `commitments`, `priv`) are
  skipped.
- **`search-schema` node option (optional):** a map of
  `field => #{ weight => W, tokenize => T }`. When present, only listed
  fields are indexed, each as its own FTS5 column with the given BM25
  weight and tokenizer. This is how an operator tunes ranking (e.g.
  Odysee: `title` and `channel-name` weighted above `description`).
- Default tokenizer: `unicode61 remove_diacritics 2` (Unicode-aware,
  case- and accent-folding).

## Query

`GET /~search@1.0/query?q=<terms>&limit=<n>&fields=<a,b>` →

1. Run `SELECT id, bm25(docs, <weights>) AS rank FROM docs WHERE docs
   MATCH ? ORDER BY rank LIMIT ?` with the query string.
2. Return the ranked list of message IDs (default `return=paths`, like
   `~query@1.0`), or the hydrated messages (`return=messages`).

For application ranking that blends full-text relevance with non-text
signals (recency, stake — the Odysee model), the device returns the
top-K by BM25 and the caller re-ranks the bounded set. Keeping the SQL
bounded and the business ranking in the caller matches FTS5's strengths
and avoids its lack of Block-WAND becoming a tail-latency problem.

## Scale

Sized for the existing Odysee dataset (~35M records). The one-time
backfill runs outside the write hook (automerge off, large transactions,
a single `optimize`); the hook handles only steady-state deltas. See the
decision doc for the FTS5 scale characteristics and the Tantivy escape
hatch if measured p99 at 35M proves insufficient.

## Build note

`esqlite` bundles SQLite with FTS5 enabled. On Linux its NIF links
through the `pc` plugin normally. On macOS the `pc` link step is a no-op
under current rebar3 (HyperBEAM's own NIFs use Makefiles for the same
reason); the `.so` is produced with a one-line post-compile link
(`cc -shared -flat_namespace -undefined suppress -o priv/esqlite3_nif.so
c_src/esqlite3_nif.o c_src/sqlite3/sqlite3.o`), wired as a `post_hooks`
entry. FTS5 BM25 queries are verified working through this binding.
