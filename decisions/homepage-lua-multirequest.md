# Decision: batch homepage reads with a generic Lua application

## Context

Homepage materialization discovers category candidates, resolves signing
channels, and ensures every selected immutable object is locally readable
before publishing a snapshot. Transporting each read as a separate HTTP
request produced hundreds of round trips and encouraged Odysee-specific cache
namespaces.

## Decision

Publish a content-addressed `application/lua` message and execute it with stock
`lua@5.3a`. Its `resolve-many` function accepts an ordered `requests` list,
calls the single-message `ao(Subreq)` form for each item, and returns ordered
per-item status and result values.

The script is generic orchestration, not a device and not a source of product
policy. Subrequests remain ordinary AO messages, so stores, remote peers, and
downstream routing are selected by node configuration. Legacy materialization
uses bare claim-ID or outpoint store reads; native objects use exact immutable
reads. Until stock edge accepts 40-hex claim IDs as direct HTTP IDs, those bare
locators are carried as the `read` field of generic `~cache@1.0` subrequests.

## Consequences

- Any stock HyperBEAM node with the immutable script and `lua@5.3a` can execute
  and verify the computation.
- One failed item does not discard successful siblings.
- The browser and materializer no longer need `source-resolve`, `local-object`,
  or `import-claims` operations.
- The current Lua implementation is sequential. Parallelism and result
  projection may be added generically later, but must preserve ordering and
  avoid changing the deployed module ID without coordinated configuration.
