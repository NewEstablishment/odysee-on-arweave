# Node operators

Concrete configuration recipes for the two node roles defined in
[architecture.md](architecture.md#node-roles), for publishing the `lbry@1.0`
device, and for hosting the UI. Node options are shown as Erlang maps in
`hb_opts` wire form (hyphenated binary keys); pass them to
`hb_http_server:start/1` or persist them via `POST /~meta@1.0/info`.

## Seed node

A seed node runs this repository as a rebar3 application (it depends on
HyperBEAM; see `rebar.config`), which puts the store modules and the
`lbry@1.0` device on the code path. Its job: source from legacy Odysee
infrastructure ([data-sourcing.md](data-sourcing.md)), verify, cache, serve.

```erlang
#{
    <<"store">> => [
        %% Local caches first: a verified fact is fetched from legacy
        %% infrastructure once, then served from disk with its commitments.
        #{ <<"store-module">> => hb_store_lmdb, <<"name">> => <<"cache-mainnet">> },
        %% The facade: `odysee/...` namespaced paths and bare LBRY-shaped
        %% keys; performs SDK locator lookups and delegates to the stores
        %% below.
        #{ <<"store-module">> => hb_store_odysee },
        %% Immutable sources. Descriptor before blob: both accept 96-hex
        %% keys; the descriptor store answers only descriptor-shaped blobs
        %% and returns not_found otherwise, falling through to the raw blob
        %% store.
        #{ <<"store-module">> => hb_store_lbry_transaction },
        #{
            <<"store-module">> => hb_store_lbry_claim_output,
            <<"walk-ancestry">> => true,
            <<"ancestry-depth-limit">> => 128
        },
        #{ <<"store-module">> => hb_store_lbry_stream_descriptor },
        #{ <<"store-module">> => hb_store_lbry_blob }
    ]
}
```

Notes:

- List order is the read order: first success wins, `not_found` falls
  through. The LBRY stores are `remote`-scoped, so scope-filtered operations
  (commitment listing, lazy-link loads) consult only the local cache — a slow
  legacy endpoint is never probed for internal bookkeeping.
- Store opts cross the wire JSON-encoded: booleans and integers may arrive as
  binaries (`<<"true">>`, `<<"128">>`). The store modules normalize; any new
  opt must too.
- Device availability: for development, `rebar3 device local` runs a node
  with the working-tree device compiled in; deployed seed nodes should pin
  the *published* implementation exactly as serving nodes do (below), so
  every node in the network runs a byte-identical `lbry@1.0`.
- Write-through caching is automatic: reads resolved over HTTP are cached per
  the node's `http-extra-opts` (see the caveat under "Serving node" — it
  applies to seeds too).

## Serving node

Stock HyperBEAM. No code from this repository. Two pieces of configuration:
trust for `lbry@1.0`, and replication from seed peers.

```erlang
#{
    %% Either: operator pinning — implementation-message ID, loaded with NO
    %% signature check. Highest precedence, simplest, and appropriate when
    %% the operator has verified the archive out of band.
    <<"trusted-devices">> => #{
        <<"lbry@1.0">> => <<"ImplementationMessageID_43chars___________">>
    },
    %% Or: signature-based trust — accept any implementation of lbry@1.0
    %% committed by the publisher's address; the archive message is fully
    %% verified (signature, signer, implements-device, requires-* keys) on
    %% first load.
    <<"trusted-device-signers">> => [
        #{
            <<"address">> => <<"PublisherAddress_43chars__________________">>,
            <<"devices">> => [<<"lbry@1.0">>]
        }
    ],
    <<"store">> => [
        #{ <<"store-module">> => hb_store_lmdb, <<"name">> => <<"cache-mainnet">> },
        #{
            <<"store-module">> => hb_store_remote_node,
            <<"node">> => <<"https://seed-1.example">>,
            %% Write-through: replicated messages land in a local store and
            %% are served from disk on subsequent reads.
            <<"local-store">> =>
                [#{ <<"store-module">> => hb_store_lmdb, <<"name">> => <<"cache-mainnet">> }]
        },
        #{
            <<"store-module">> => hb_store_remote_node,
            <<"node">> => <<"https://seed-2.example">>
        }
    ]
}
```

**Verification caveat on remote reads.** `hb_store_remote_node` fetches via
the peer's `/~cache@1.0/read`, strips the peer's transport commitment, and
narrows the message to keys covered by the remaining commitments — but it
performs **no cryptography**. Left there, a malicious seed could populate a
serving node's cache with well-shaped forgeries. Close the gap with one of:

```erlang
    %% Re-verify every message recursively in all resolution contexts — or
    %% scope with a topic list such as `[cache_read, cache_write]`. Dispatches
    %% each commitment to its commitment-device — i.e. through the pinned
    %% lbry@1.0 archive:
    <<"paranoid-verify">> => true
```

or verify explicitly after replication with
`hb_message:verify(Msg, #{ <<"commitment-ids">> => <<"all">> }, Opts)` —
the `commitment-ids => all` selection is required, because content-addressed
`lbry@1.0` commitments have no committer and are skipped by both the default
and the committer-based selections
([architecture.md](architecture.md#trust-model)). End users are protected
regardless (the browser re-verifies); this setting protects your cache and
your peers.

**`http-extra-opts` and mutable surfaces.** The stock default is

```erlang
    <<"http-extra-opts">> =>
        #{ <<"force-message">> => true, <<"cache-control">> => [<<"always">>] }
```

`always` caches every HTTP-resolved result. That is correct for the immutable
namespaces (outpoints, txids, hashes) and wrong for mutable ones —
`odysee/claim-id/<id>` resolves to the *current* outpoint, and `~query@1.0`
results change with every write. The UI sends
`cache-control: no-store, no-cache` on its mutable reads; a node fronting
other clients should either rely on that or drop `always`:

```erlang
    <<"http-extra-opts">> => #{ <<"force-message">> => true }
```

## Publishing the device (Forge)

The Forge packages a device project into two committed messages and publishes
them, giving consumers a content-addressed artifact to pin.

```sh
rebar3 device package          # build the archive deterministically
rebar3 device verify           # validate the archive contents
rebar3 device test             # run the device test suite (HB_PORT to pin a port)
rebar3 device publish --key wallet.json
```

Publishing produces:

- The **Device-Specification** message: `type: Device-Specification`,
  `name: lbry@1.0`, `content-type`, `body` = the spec text (the module's
  `%%%` doc block or a `-specification(...)` file). Its *signed* ID is the
  SpecID.
- The **implementation** message:
  `content-type: application/beam-archive`, `archive-format: zip`,
  `implements-device: <SpecID>`, `module-name: _hb_device_lbry_...`,
  `requires-otp-release: <N>`, `body` = the BEAM archive. Its signed ID is
  the ImplID that operators pin.

Identity is the source set: the module hash embedded in `module-name` is
derived from the unsigned AO-Core ID of the `{filename => contents}` map over
every source, include, and priv file — the author cannot choose it, and two
versions coexist on one node without atom collisions.

Consumers pin by one of the two mechanisms shown in the serving-node recipe.
For signer-based trust, the consuming node also needs (a) name resolution
`lbry@1.0 → SpecID` — the publisher's signed preloaded-index ID works as a
`name-resolvers` entry — and (b) a store able to fetch the implementation
message (a gateway store entry, or a seed peer that carries it). Gateway
discovery of implementations only activates when `trusted-device-signers` is
non-empty. Gotcha: the packager always stamps `requires-otp-release`, so
publisher and consumer must run the same OTP major, or the publisher ships
per-OTP builds.

## Hosting the UI

The UI is a static SPA build (all endpoint URLs, including the node base URL,
are baked at build time). Host it as an Arweave **path manifest**:

1. Upload each built file as its own message/transaction with a correct
   `content-type` (the manifest layer adds none — content-types come from the
   stored messages).
2. Upload the manifest (v1 schema), with
   `content-type: application/x.arweave-manifest+json`:

   ```json
   {
     "index": { "path": "index.html" },
     "paths": {
       "index.html":     { "id": "<43-char message ID>" },
       "assets/app.js":  { "id": "..." }
     }
   }
   ```

3. Serve from any node: `GET /<ManifestID>` returns the index page,
   `GET /<ManifestID>/<path>` returns each asset. The stock `on/request`
   hook chain includes `manifest@1.0`, which recognizes manifests by their
   `device` tag or `content-type` — no extra configuration on a default
   node. Missing paths fall back to the index (`manifest-404: fallback`, the
   default), which is exactly SPA client-side routing; set
   `<<"manifest-404">> => error` (atom-valued, like the `fallback` default)
   to disable.

The serving node must be able to *read* the manifest and every path-target ID
through its store stack: either seed them into the local cache directly, or
include a gateway/Arweave store entry so they load from the network on first
request. One routing caveat: the index fallback does not fire for a missing
file under a path that exists as a manifest *folder* — keep client-route
prefixes (e.g. `/watch/...`) out of the manifest's directory structure.
