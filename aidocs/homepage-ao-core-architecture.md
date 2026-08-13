# Homepage AO-Core Architecture

## Goal

Serve a complete, language-specific homepage through stock HyperBEAM semantics
without browser fan-out, Odysee-specific generic devices, or custom cache-key
APIs. A homepage refresh must publish only after every referenced media,
channel, and banner object is available by immutable native ID. Until then, the
previous snapshot remains current.

The browser path is:

```text
discover current snapshot locator
    -> GET /<snapshot-id>
    -> Lua multirequest for visible immutable object IDs
    -> Lua multirequest for the remaining displayed object IDs
    -> Redux ingestion in snapshot order
```

Legacy sources may be used by the materializer while migration is incomplete,
but they are not part of the browser or snapshot read contract.

## HyperBEAM Model

HyperBEAM's Erlang modules implement AO-Core rather than a conventional HTTP
application model. The architecture therefore follows these rules:

1. Application behavior is expressed as messages and application-layer
   programs. No kernel or generic-device change is required.
2. Immutable objects are resolved directly by ID. `GET /<id>` means the exact
   committed object identified by that ID.
3. Discovery returns immutable locators. Hydration is a separate operation that
   preserves discovery order.
4. Messages may contain lazy links. Callers must not assume that an AO-Core
   message is an eagerly loaded Erlang or JavaScript map.
5. Cache and query devices remain generic. Odysee-specific selection,
   compatibility import, and Redux projection stay in their owning layers.

These rules follow the HyperBEAM `edge` versions of `AGENTS.md`,
`CONTRIBUTING.md`, `hb_ao`, `hb_cache`, `hb_message`, and `hb_link`.

## Generic Lua Multirequest

### Module

Publish a small `application/lua` message and invoke it by its immutable module
ID:

```text
POST /~lua@5.3a&module=<lua-module-id>/resolve-many
```

The request contains an ordered AO-Core list:

```json
{
  "requests": [
    { "path": "/<immutable-id-1>" },
    { "path": "/<immutable-id-2>" }
  ]
}
```

Exact publisher verification uses the canonical direct HTTP paths:

```text
/<id>
/<id>/verify?commitment-ids=<id>
/<id>/commitments/<id>/committer
```

The caller accepts a signed snapshot only when all three reads validate the
same immutable ID and expected committer. Nested paths are deliberately not
sent through the Lua singleton because the current Lua AO resolver treats the
loaded ID result as the end of that subresolution. Legacy LBRY evidence follows
its dedicated commitment and ancestry verification rules at ingestion.

The Lua function iterates `req.requests` and calls `ao.resolve(subrequest)` for
each item. This single-argument form is supported by `dev_lua_lib`: it passes
the message through `hb_singleton:from` and then calls
`hb_ao:resolve_many/2`. This must still be covered by an integration test using
`hb_ao`, because the API's Erlang syntax hides AO-Core parsing semantics.

The response is an ordered list of per-item outcomes:

```json
[
  { "status": "ok", "result": {} },
  { "status": "error", "result": "not_found" }
]
```

One failed subrequest does not fail the batch. The first implementation may be
sequential inside Lua: eliminating hundreds of HTTP transports is the primary
gain. A generic bounded-concurrency primitive can replace the loop later
without changing the caller contract.

The module is generic. It knows nothing about homepages, LBRY, Odysee, claims,
or cache namespaces. Its module ID is deployment configuration, and the same
immutable script can execute on any stock node that has `lua@5.3a` and access
to the referenced messages.

### Request Safety

- Preserve request order exactly.
- Return status and result for every item.
- Bound the number of subrequests per invocation.
- Do not include credentials in the script message, request body, result, or
  snapshot.
- Apply node routing and device sandbox policy to each nested AO resolution.
- Resolve direct immutable paths, not `odysee/local-object/<id>` aliases.

## Snapshot Message

Publish one immutable snapshot message per language and refresh cycle:

```json
{
  "schema": "odysee-homepage@1.0",
  "type": "homepage-snapshot",
  "language": "en",
  "epoch-hour": 496261,
  "created-at": 1786543017,
  "content-hash": "<sha256-base64url>",
  "homepage": { "categories": {}, "featured": {} }
}
```

`homepage` retains the frontend's category document shape, including ordered
`immutableIds` arrays and the media-to-native-channel mapping. `content-hash`
is computed over canonical JSON so transport decoding cannot silently alter the
snapshot document.

The snapshot contains immutable locators and display ordering, not mutable
LBRY URIs or claim IDs. Media and channel objects remain authoritative and are
hydrated separately. Native media messages should directly identify their
native signing-channel message. Legacy channel claim IDs are translated only
by the materializer during compatibility ingestion.

A language snapshot contains public categories and their default order. It
does not contain a user's category preferences or Following feed. The frontend
applies each user's enabled-category and ordering preferences to the category
IDs in the snapshot.

Updating a homepage creates a new immutable snapshot. A generic query over the
current and recent `epoch-hour` buckets discovers candidates for a language;
exact ID verification then restricts them to the configured publisher identity.
The materializer writes the snapshot only
after all dependencies pass validation, so discovery continues to select the
previous complete snapshot if a refresh fails. No mutable snapshot pointer is
required.

## Materialization Pipeline

### 1. Discover candidates

Run the configured category queries for one language. Native query/search
surfaces return immutable message locators. During migration,
`hb_store_odysee` may obtain verified legacy source objects behind the store
boundary, but the materializer normalizes them immediately to native immutable
IDs.

Category selection remains dynamic. The snapshot is a periodically refreshed
result, not a permanent static homepage.

### 2. Select complete rows

Apply homepage policy in the materializer:

- configured public category and default ordering;
- pinned entries;
- freshness and future-release constraints;
- per-channel limits;
- no livestream entries until native livestream support exists;
- enough reserve candidates to replace unavailable objects.

Start with three times the displayed row size. If verification and import
leave a category incomplete, double only that category's candidate page count
and freshness window in bounded rounds. Complete categories keep their normal
reserve and configured freshness. The final round may append a semantic
category-tag query after an exhausted curated channel pool. If the expanded
reserve still cannot fill every row, reject the refresh and continue serving
the previous signed snapshot.

### 3. Resolve channels

Use the native signing-channel ID carried by each media message. For legacy
media that has not yet been fully migrated, batch the compatibility lookup in
the materializer and retain only the resulting native channel ID.

### 4. Import legacy objects

For selected objects with known legacy outpoints, invoke compatibility
ingestion before hydration. The import response contains only outpoints whose
native messages were verified and committed to the local HyperBEAM store. An
already committed outpoint is returned from a local direct-ID check without
re-fetching source evidence. Only unresolved imports are retried, with bounded
backoff, while the previous snapshot remains served. Failed source imports are
unavailable candidates; they must not fall through to remote Arweave gateway
probes. A cache write counts as complete only after an exact local read-back of
the expected native ID; the write return value alone is not sufficient.

This migration path does not create a browser-visible alternate identity.
Source URI resolution is permitted only here when an old homepage definition
does not yet contain an immutable target. Homepage definitions should be
migrated to immutable banner IDs so `odysee/source-resolve/<uri>` can be removed
from this pipeline.

### 5. Hydrate by immutable ID

Send media, channel, and banner `/<id>` singleton requests to the Lua module in
bounded batches. This replaces the current hundreds of
`odysee/local-object/<id>` HTTP requests.

Legacy IDs confirmed by the completion-aware import response are already
hydrated locally. Direct Lua resolution is required for native-only IDs and at
runtime when reading the published snapshot.

For native application messages requiring publisher authority, perform the
canonical exact verification reads after direct hydration.

### 6. Validate and publish

Reject the candidate snapshot unless:

- every displayed media ID resolves directly;
- every displayed media item has a resolvable native channel ID;
- every banner target resolves directly;
- every native product message passes exact commitment and committer checks;
- every configured row has its required number of entries;
- all IDs and category orders are deterministic;
- no entry violates release-time or livestream policy.

Write the immutable snapshot, verify it by its returned commitment ID and
publisher, then atomically replace the local deployment snapshot. Never replace
the current local or native snapshot before these checks pass.

## Runtime Read Path

The server or decentralized client performs one generic query, restricted to
the configured publisher, to discover the latest signed snapshot for the
user's language and one direct read of that snapshot ID. It sends viewport
media and channel IDs to the Lua module first, followed by all remaining IDs in
the displayed rows.

The frontend ingests successful results into Redux in snapshot order. It does
not resolve mutable LBRY URIs, issue one request per card, or infer channel
identity from display fields. Viewport priority may split hydration into an
initial visible batch followed by remaining displayed entries, but every entry
in the snapshot's displayed rows must eventually be requested.

SSR may include the discovered snapshot message in the initial document. That
is an optimization of the same native contract, not a server-owned cache or a
second homepage mode.

### Personalized Following

Following is not published in a shared language snapshot. It is discovered for
the active user through the native following relationship and media indexes.
That discovery returns immutable media locators sorted by release time. The
same Lua module hydrates those media and channel IDs.

The frontend computes the effective category order from the language snapshot
and user preferences before scheduling hydration. If Following is first for a
user, its discovery and visible object batch receive first priority. If another
category is first, that category receives first priority. The implementation
must not hard-code Following or any public category as globally first.

## Routing

Direct `/<id>` resolution is the stable contract. Nodes may satisfy it from a
local store, a configured downstream node, or a decentralized source without
changing the request. Routing missing subrequests downstream is a node
configuration concern.

Custom paths remain limited to compatibility ingestion while legacy objects
exist. In particular:

- remove runtime use of `odysee/local-object/<id>`;
- remove snapshot/runtime use of `odysee/source-resolve/<uri>`;
- do not add a homepage device or Odysee behavior to `cache@1.0`,
  `message@1.0`, `query@1.0`, or `search@1.0`;
- do not expose source services directly to React.

## Delivery Plan

### Phase 1: Prove the Lua application (complete)

1. Add the generic Lua module as an application artifact.
2. Add an EUnit test that invokes it through `hb_ao` with multiple singleton
   requests, including a direct immutable ID and a failing request.
3. Verify ordered per-item results and the single-argument
   `hb_singleton:from` path.
4. Publish the module as an immutable message and configure its ID.

### Phase 2: Replace materializer fan-out (complete)

1. Add a frontend-server helper for the Lua route.
2. Replace individual local-object probes with bounded Lua batches of direct
   `/<id>` requests.
3. Batch category and channel AO subrequests through the same module where
   doing so removes transport fan-out without moving product policy into Lua.
4. Import known legacy outpoints first and accept only completion-confirmed
   local writes; never remote-probe a failed legacy import.
5. Remove the materializer's dependency on `odysee/local-object/<id>`.
6. Benchmark category discovery, channel resolution, import, and immutable
   hydration separately.

### Phase 3: Publish native snapshots (complete)

1. Define and validate `odysee-homepage@1.0` messages.
2. Publish one immutable snapshot per language only after full dependency
   validation.
3. Discover the latest signed snapshot through generic query semantics.
4. Restrict discovery to the configured snapshot publisher identity.
5. Keep the previous snapshot current across failed or in-progress refreshes.
6. Schedule refreshes through stock HyperBEAM application composition, with
   the Lua module performing nested AO requests. Do not introduce a custom
   homepage device.

### Phase 4: Use the native runtime contract

1. Load the user's language snapshot directly by immutable ID.
2. Merge user category preferences and native Following discovery into the
   effective category order.
3. Hydrate viewport entries first through the Lua batch, then the rest of all
   displayed rows.
4. Ingest media and channel messages into Redux in effective category and
   discovery order.
5. Remove browser and SSR fallbacks that briefly render the following feed or
   mutable homepage definitions.

### Phase 5: Retire compatibility aliases

1. Convert featured/banner definitions to immutable native IDs.
2. Ensure native media messages carry native signing-channel IDs.
3. Remove homepage use of `odysee/source-resolve`, mutable channel claim IDs,
   and legacy URI routing.
4. Remove store aliases that have no remaining ingestion caller.

## Validation Gates

- HyperBEAM EUnit coverage calls the Lua device only through `hb_ao`.
- Run `rebar3 eunit-all` against the relevant HyperBEAM revision.
- Run `rebar3 device test --with-core` for the application repository.
- Run materializer tests for ordering, partial failures, import retries,
  complete-row enforcement, channel completeness, exact commitment checks,
  publisher filtering, and atomic publication.
- Run frontend format, TypeScript, and project checks.
- Exercise the real HTTP route against the local HyperBEAM node.
- Measure request count and timings before and after migration. The expected
  transport reduction is from hundreds of per-object HTTP requests to bounded
  Lua invocations plus category discovery and import requests.
- Verify that a failed refresh continues serving the prior snapshot.

## Decisions Deferred

- Whether generic multirequest gains bounded parallel AO resolution in
  HyperBEAM after the Lua version proves the contract.
- The exact generic query/index used as the current-snapshot locator.
- Whether the first viewport and remaining displayed rows use separate Lua
  calls or one full hydration call.
- The long-term decentralized scheduler topology. It must publish the same
  signed snapshot messages and must not change the read contract.
