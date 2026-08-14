# Architecture

Odysee runs as a standalone OTP application on a pinned upstream HyperBEAM
dependency. The browser is a static manifest application. It talks to generic
HyperBEAM HTTP, message, cache, Lua, and query surfaces; historical Odysee
services are byte sources behind the seed node's store stack.

```text
Static manifest browser
    -> generic HyperBEAM routes
    -> local or remote store stack
    -> verified immutable LBRY evidence or native committed messages
```

## Trust and identity

- `lbry@1.0` is the single commitment device for historical transaction,
  claim, channel, stream, descriptor, blob, and attestation evidence.
- Immutable IDs and outpoints identify exact evidence. Names and claim IDs are
  locators and may resolve to newer evidence.
- Source stores fail closed: they recompute transaction and SHA-384 identities
  before an object can be served or cached.
- Native uploads, profiles, comments, and revisions are append-only committed
  messages written through `/id?!=true&committers=all` and discovered through
  `query@1.0`.
- Indexes locate messages but are never authoritative.

## Node roles

A seed node runs this application and stacks the Odysee/LBRY source stores
after its local caches. A serving node can remain stock HyperBEAM: it loads the
trusted `lbry@1.0` archive and routes store misses to one or more seed peers
with `hb_store_remote_node`.

The generic homepage Lua application is content-addressed data, not a trusted
device. `hb_odysee_node` publishes it before accepting traffic. Any stock node
with `lua@5.3a` can execute and verify the same computation.

## Homepage and categories

The materializer publishes one signed immutable `odysee-homepage@1.0` snapshot
per language. Each category contains an ordered pool of immutable media IDs
and the corresponding immutable signing-channel IDs. The homepage renders a
prefix of that pool; category routes use the larger pool for first paint and
continue with store-first discovery.

Snapshot replacement is atomic from the reader's perspective: the previous
verified snapshot remains discoverable until a complete replacement has been
built, warmed, committed, and verified. Following is personalized and remains
a dynamic query rather than part of a public language snapshot.

### AO multirequest

The materializer groups same-phase work into ordered subrequests and invokes:

```text
POST /~lua@5.3a&module=<immutable-lua-id>/resolve-many
```

The module accepts `Req.requests`, calls the single-message `ao(Subreq)` form
for each element, and returns ordered `{status, result}` entries. A failed
subrequest does not fail its siblings. It contains no Odysee policy and does
not introduce a custom device.

The batched graph is:

1. Category source discovery, one AO batch for all same-phase category pages.
2. Banner locator resolution through ordinary cache or direct locator reads.
3. Signing-channel discovery, batched in claim-ID groups.
4. Ordinary reads for selected media and channel locators, which cause
   verified source evidence to be cached under its immutable identity.
5. Snapshot publication only after every displayed media object and required
   channel object is readable.

There is no browser-side `local-object` probe and no `source-resolve` or
`import-claims` materializer operation. A legacy claim ID or outpoint is the
bare `read` value of generic `~cache@1.0`; a native 42/43-character immutable
ID is read directly. This stock-edge-compatible form avoids a custom cache
namespace while keeping downstream routing in node configuration rather than
Lua or browser policy.

## Browser boundary

`ODYSEE_HYPERBEAM_NODE_API` selects the node; it is not a legacy-mode switch.
The browser must not call Commentron, Lbryio, SDK proxy, Lighthouse,
Meilisearch, recommendations, or geo services as an alternate product path.
SDK-shaped objects may be produced only as a Redux compatibility adapter after
generic HyperBEAM reads.

## Build and deployment

HyperBEAM is pinned by commit in `rebar.config`. Current edge requires a Forge
preloaded store for named devices such as `lua@5.3a`:

```sh
HB_PORT=0 rebar3 device local
```

Start nodes with `HB_PRELOADED_STORE=_build/device-local-store`. The frontend's
`HYPERBEAM_MULTIREQUEST_MODULE_ID` must match the immutable module published by
`hb_odysee_lua`; the checked-in Lua body is deliberately stable so deployed
module IDs do not drift implicitly.
