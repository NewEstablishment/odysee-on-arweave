# Decision: keep the `fixtures` store-opt (do not remove per audit P2/#5)

## The finding

The idiom audit flagged the `fixtures` store option (a map of
path/hash → pre-seeded content, set only under `-ifdef(TEST)`) as
non-idiomatic: for the facade it duplicates layering a local store
ahead of the remote source, and for the kind stores it short-circuits
the HTTP fetch. The suggested fix was to delete it family-wide and have
tests layer a real `hb_store_fs`/`hb_store_volatile` (facade) or drive
the HTTP-fetch path through a mock server (kind stores).

## Why keep it

- **It is a clean, offline test-injection seam.** Every store test runs
  with no network; the corpus was HEAD-verified once and the suite is
  deliberately offline. `fixtures` is how a test says "when asked for
  this key, here are the bytes" without standing up a mock HTTP chain.
- **Removing it does not clearly reduce complexity.** The kind stores'
  source is HTTP (SDK proxy JSON-RPC, blob CDN GET), not a store — so
  `fixtures` is not a redundant cache layer there, it mocks the source.
  Replacing it means adding `hb_mock_server` setup to each fixture-based
  test; the mock scaffolding roughly replaces the fixture scaffolding,
  so net LoC barely moves while test readability drops.
- **Production cost is negligible.** The fixture branch is one map
  lookup that returns `not_found` immediately when the option is absent
  (it never is, in production).
- **Surgical default.** Where a cleanup's benefit is ambiguous and its
  risk to intricate, real-crypto store tests is real, the smaller diff
  wins.

## The genuinely more-idiomatic alternative (future option, not now)

Give the kind stores an HTTP-backed *source store* at the bottom of
their stack (a store module that fetches blob bytes from the CDN and tx
hex from the SDK proxy), with a local cache/fs store on top — the exact
`hb_store_gateway` shape. Then the raw source flows through the store
abstraction, tests inject by pre-seeding the local store, and `fixtures`
disappears. This is the right end state, but it is a real refactor (a
new source-store abstraction, rewiring every kind store off direct
HTTP), out of proportion to a test-seam cleanup. Recorded here so it is
a deliberate deferral, not an oversight.
