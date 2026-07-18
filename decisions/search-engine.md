# Decision: `~search@1.0` full-text engine — SQLite FTS5 via `esqlite`

## Original prompt (as understood)

Build a *generic* full-text indexer device for HyperBEAM data. Schema
from node Opts `search-schema` (if needed at all); invoked via a hook on
message writes to the store; index all fields by default; scale to the
existing Odysee dataset of ~35M records. Engine must be terse and
well-specified in the LMDB spirit — not over-engineered or bloated, no
server daemons.

## Choice: SQLite FTS5, embedded through the `esqlite` NIF

### Why (single strongest reason)

FTS5 is the only candidate that is simultaneously (a) a single-file,
exhaustively-specified, embedded C library — the exact "one fast simple
file implementing the underlying algorithm" aesthetic that makes LMDB
the house favorite; (b) equipped with built-in BM25 relevance and
per-column weights; and (c) reachable from Erlang through a mature,
maintained NIF. The whole index lives in one `.db` file (FTS5 keeps its
inverted index in shadow tables inside that same file). The runtime
already links C NIFs (`elmdb`, `rocksdb`), so a bundled-SQLite NIF adds
no new class of dependency and zero new processes.

### Integration path

- **`esqlite`** (`mmzeeman/esqlite`): bundles SQLite 3.45.x with
  `SQLITE_ENABLE_FTS5` and WAL compiled in, runs on dirty schedulers,
  actively maintained. Primary binding.
- **`max-au/sqlite`** (hex `sqlite`, v2.0): fallback with a stronger
  BUSY/LOCKED reschedule design if writer contention becomes hot —
  verify FTS5 is enabled in its build flags before adopting.
- Wire it exactly as `hb_store_lmdb` wires LMDB: a singleton `gen_server`
  owns the single write connection and batches `INSERT`s in a
  transaction (LMDB uses a 5000-op dual-flush batch); a pool of
  read-only WAL connections serves queries concurrently. The device
  indexes **asynchronously** off the cache-write hook, never on the hot
  write path.

### Device shape (to design in the build task)

- `~search@1.0` is generic: it indexes whatever fields a message has.
- **Write hook**: HyperBEAM already runs `write_match_index/3` on every
  `hb_cache:write` (the `~match@1.0` exact-KV reverse index). `~search`
  is the full-text analogue, attached the same way — a hook on store
  writes enqueues `{ID, Fields}` for async indexing. Investigate
  whether the existing `on` hook config or the cache write-index seam is
  the cleanest attachment point (prefer reusing the seam over a new one).
- **Schema**: honor node Opts `search-schema` when present (field
  whitelist + per-field tokenizer/weight); default to "index every
  string field with `unicode61 remove_diacritics 2`" when absent, so the
  device is useful with zero configuration.
- **Table**: external-content or contentless FTS5 — the canonical
  message already lives in the node's store, so the FTS DB holds only
  the index plus ranking signals (`rowid` = message/claim ID; keep
  non-text signals like recency/stake in a plain shadow row).
- **Ranking**: column-weighted BM25 as the SQL default rank with a hard
  `LIMIT`, then a two-stage re-rank in Erlang blending recency and
  amount for the Odysee model — keeps SQL bounded, business ranking
  tunable in the device.

### Main risk + mitigation

FTS5 has no Block-WAND/MAXSCORE, so a high-frequency multi-term query
over 35M rows scores the full posting list and can spike tail latency —
the one place Tantivy structurally wins. Mitigate with scheduled
`optimize`/`merge`, the bounded two-stage retrieve-then-rerank, a warm
page cache on fast storage, and a one-time bulk backfill (automerge off,
large transactions, single `optimize`) separate from the steady-state
hook. Architectural insurance: the device exposes a stable query/schema
contract, so the backend can be swapped to a Tantivy NIF later without
changing the device interface if measured p99 at 35M is unacceptable.
Validate against a real 35M load with the actual Odysee query mix before
quoting production latency.

### Rejected

- **Tantivy** (#2, escape hatch): best raw scale/latency but no mature
  Erlang binding (the Elixir/port options are early and unproven);
  adopting it means owning a bespoke Rust NIF — more surface than
  "terse." Directory-of-segments, not single-file.
- **Hand-rolled LMDB inverted index**: re-implements tokenization,
  posting-list encoding, BM25 scoring, segment merges, and tombstones in
  Erlang — the opposite of terse, and Erlang-side BM25 over large
  posting lists is slow. Only justified under a hard no-C-dependency
  rule, which the `elmdb`/`rocksdb` precedent already disproves.
- **Xapian** (C++): mature BM25 but no maintained Erlang binding and a
  directory index — more integration work than FTS5 for no relevance
  gain.
- **Sonic / Bleve**: separate daemon / Go-runtime bridge; Sonic also
  lacks true BM25.
- **Meilisearch / Elasticsearch / OpenSearch / Solr**: server daemons
  with multi-GB footprints — exactly the bloat the brief rules out.

Full research brief: `scratchpad/search-research.txt`.
