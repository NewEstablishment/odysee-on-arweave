# HyperBEAM-owned homepage snapshots

## Decision

Homepage and category claim selections are immutable, node-signed
`odysee-homepage@1.0` messages. The frontend bundle contains presentation
templates only.

At startup, the Odysee OTP application writes the immutable Lua materializer
and its language plan to the node cache. The Lua script executes its store and
search subrequests with `ao.resolve`, follows HyperBEAM message links, exact-
hydrates candidate media and channels, and commits a snapshot through generic
`message@1.0` behavior. It relays the signed write to the node's own writable
`cache@1.0` HTTP boundary; the loopback relay allowlist prevents arbitrary
internal-host relay. The node starts with one bounded
snapshot for the configured initial language. After that succeeds, stock
`cron@1.0` immediately builds the full all-language pool and repeats at the
configured interval.

Consumers discover snapshot locators with `query@1.0`, exact-read them, verify
the commitment and require the node's own committer. The newest valid snapshot
for the language wins. Failed refreshes do not replace or delete prior valid
messages.

## Consequences

- A deployment generates snapshots from its own store and search index.
- Homepage rows and category routes share the same ordered immutable pools.
- Optional local content is configuration, not a product rule in a generic
  device.
- SSR, browser timers, filesystem JSON, and build-time materialization are not
  authority or refresh mechanisms.
- The Lua script and snapshot can be executed and verified on stock HyperBEAM
  primitives without trusting a custom homepage device.
