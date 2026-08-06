# Odysee on HyperBEAM: demo

Everything the browser renders comes from one HyperBEAM node running four
devices and five stores. Legacy Odysee infrastructure is a byte source only:
every fact served is re-derived from raw bytes and carried as a commitment.

## Run

```sh
# 1. Build the UI (once). The node API must be set at BUILD time.
cd frontend
corepack enable && corepack prepare pnpm@10.33.0 --activate
pnpm install
NODE_ENV=production ODYSEE_HYPERBEAM_NODE_API=http://127.0.0.1:18800 pnpm build

# 2. Build the preloaded device store (once).
cd .. && HB_PORT=18734 rebar3 device local    # ctrl-C twice once it boots

# 3. Start the node and publish the UI into it. Single line; hold stdin open.
HB_PRELOADED_STORE=_build/device-local-store rebar3 shell --eval 'Opts = hb_odysee_node:seed_opts(#{<<"port">> => 18800, <<"priv-wallet">> => ar_wallet:new(), <<"http-extra-opts">> => #{<<"force-message">> => true, <<"cache-control">> => [<<"no-store">>]}}), Node = hb_http_server:start_node(Opts), {ok, M} = hb_odysee_ui:publish("frontend/web/dist/public", Opts), io:format("~n=== NODE ~s~n=== MANIFEST ~s~n", [Node, M]), receive stop -> ok end.' < <(sleep 100000)
```

Open `http://127.0.0.1:18800/<MANIFEST>/#/@conculturepodcast:c/what-if-anakin-won-star-wars-alternate:b`

## What to show

**1. A real video, playing, verified.** The `<video>` src is
`/~cache@1.0/read?read=odysee/media/stream-id/<txid>:<nout>`. The node fetched
the descriptor, pulled each blob from the CDN, checked every blob against its
SHA-384 hash, AES-decrypted and reassembled the file. A single wrong byte is a
read failure, not a served video.

**2. The response IS the proof.** Any read returns an ordinary HTTP response
that is a verifiable message:

```sh
curl -sD - -o /dev/null "http://127.0.0.1:18800/~cache@1.0/read?read=odysee%2Ftransaction%2F<txid>"
```

`signature-input` shows the commitment covering `("raw" "txid")` with
`alg="lbry@1.0/sha-256d"`. Recompute `reverse(sha256d(raw))`, compare to
`txid`. The node is a transport, not an oracle.

**3. Content is addressable by plain HyperBEAM ID.** The alias is a pure
function of the store path, computable offline by any client:

```sh
python3 -c "import hashlib,base64;print(base64.urlsafe_b64encode(hashlib.sha256(b'odysee-alias:v1:odysee/transaction/<txid>').digest()).decode().rstrip('='))"
curl -sD - -o /dev/null "http://127.0.0.1:18800/<that-43-char-id>"
```

Same object, no path, no device call. This is what lets `~query@1.0`, a peer,
or a router such as weave.space address Odysee content.

**4. Second load is local.** The first read hits legacy infrastructure; after
that it is served from the node's own store with its commitments intact.

## What does not work yet

- Comments, uploads, reactions, view and subscriber counts, moderation: those
  devices were deleted and have not been rebuilt.
- Homepage tiles: claims resolve (200) but the frontend wants decoded display
  metadata that evidence messages do not carry.
- Video seeking: `dev_cache` drops the request, so Range headers never reach
  the store. Playback is whole-object only.
- Account functions: the banner is expected, there is no account backend.

The demo is the read and verification plane, which is the hard part. Feature
breadth is ordinary work on top of it.
