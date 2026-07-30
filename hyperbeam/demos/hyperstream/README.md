# Hyperstream Broadcast Demo

This dependency-free demo exercises `hyperstream@1.0` without the Odysee
frontend. It has two independent surfaces:

- `/` is the broadcaster console. It owns the Hyperstream session, captures an
  animated canvas, and creates one WebRTC peer connection per viewer.
- `/watch.html#invite=...` is the watch page. Every tab creates its own peer
  signing identity, joins the open session, and negotiates its own media
  connection.

HyperBEAM carries membership, leases, ordered lifecycle events, and targeted
offer, answer, and ICE envelopes. WebRTC carries the media directly from the
broadcaster to each viewer.

Every demo client signs its outer HyperBEAM requests with one browser-generated
RSA-PSS/SHA-512 identity. It obtains the node's public ephemeral P-256 key from
the signed `transport-key` operation, then seals semantic request and response
bodies with the `hs1` P-256 ECDH, HKDF-SHA256, and AES-256-GCM transport.
Ordinary HyperBEAM HTTP, hook, signing, and store paths therefore see
ciphertext. The trusted node still decrypts the envelopes to coordinate the
session.

## Run

Start HyperBEAM from `hyperbeam/`:

```sh
HB_CONFIG=demos/hyperstream/hyperbeam-config.json \
  HB_PORT=18785 rebar3 device local
```

`hyperstream@1.0` is a normal Forge-packaged device and does not require a
patched HyperBEAM core. A separate stock node can use a preloaded store
containing the package or load a published package through its standard
`trusted-devices` or `trusted-device-signers` policy.

The supplied config disables `store-all-signed`, because the demo's signed
heartbeat and poll requests would otherwise be persisted as ciphertext at high
frequency by a stock node. `Cache-Control: no-store` does not control that
server-side policy. The config also disables recording until explicit
`hyperstream-recording-signers` are supplied.

Serve the demo from a second terminal in `hyperbeam/`:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory demos/hyperstream
```

The dependency-free Node server applies the production response headers used by
the public demo:

```sh
HOST=127.0.0.1 PORT=4173 \
  HYPERBEAM_ORIGIN=http://127.0.0.1:18785 \
  node demos/hyperstream/server.mjs
```

Open <http://127.0.0.1:4173/>, select **Start broadcast**, and copy the generated
watch URL into another tab or browser. Each viewer joins automatically.

The default node address is loopback, so its watch URLs work only on the same
machine. For viewers on other devices, serve the demo and direct Hyperstream
route through reachable HTTPS origins and enter that public node URL before
starting the broadcast. A site named `demoN.example` automatically selects
`https://devhbN.example`; other public hosts default to a same-origin node route,
and the field remains editable.

## What the pages expose

The broadcaster console shows:

- Session, owner peer, generation, cursor, and current server peer count.
- Every joined viewer's peer ID, generation, connection ID, WebRTC state, ICE
  state, signaling state, selected candidate types and transport, round-trip
  time, encoded frames, packets, and outbound bytes.
- Sanitized create, join, ready, offer, answer, ICE, leave, and close activity.
- Transport-key bootstrap, device-call and signal counts, plus the observed
  `no-store` cache policy.
- A five-step proof that the session, public watch locator, independent viewer,
  offer/answer exchange, and outbound RTP path are live.

Each watch page shows:

- Its independently generated peer ID, generation, and connection ID.
- Publisher identity, event cursor, WebRTC, ICE, gathering, and signaling state.
- Selected local/remote candidate types, transport protocol, and round-trip
  time without candidate addresses or ports.
- Decoded frames, received bytes and packets, packet loss, jitter, and video
  dimensions.
- Sanitized device calls and signaling events, including rejected foreign or
  stale-generation signals.

The event rails render operation names, peer IDs, generations, cursors, states,
timings, and payload sizes. They never render peer capabilities, SDP, or ICE
candidate bodies. Browser storage is not used.

## Watch URL and admission

The demo intentionally creates an open session suitable for a public
livestream. Its watch URL fragment contains only a version, node endpoint,
session ID, and publisher peer ID. It contains no owner credential, viewer
credential, signing key, peer token, join token, SDP, ICE, or TURN secret. Every
viewer generates a fresh signing identity in memory and uses its verified signer
as the Hyperstream peer credential.

Open admission is a demo policy, not an internet-facing abuse-control layer.
Production deployments must add ingress admission, per-address or
authenticated-principal rate limits, practical viewer caps, and body limits.
The broadcaster itself admits at most eight simultaneous media connections and
limits repeated negotiation attempts per viewer generation. The session ID is a
locator, not authentication, and peer role metadata is self-asserted. Private
streams should use verified-signer admission or distribute a restricted-session
capability through a separate authenticated channel. Capabilities must remain
inside sealed request bodies and must never be placed in watch URLs.

Normal stop and leave actions send signed and sealed requests. Browser
`pagehide` cannot reliably finish that asynchronous exchange, so an abruptly
closed tab is removed when its peer lease expires.

## Production boundaries

This is a signaling and direct publisher-to-viewer WebRTC demonstration. It
does not provide TURN, an SFU, RTMP termination, transcoding, automatic
segmentation, or replay playback. Direct publisher mesh is appropriate for a
small demonstration; publisher upload and encoding work grow with every viewer.
Direct ICE candidates can also expose broadcaster and viewer network addresses
to one another. HTTPS protects the signaling hop but does not hide those
addresses from the connected peer.

The demo uses Cloudflare's public STUN endpoint by default so direct peers can
discover server-reflexive candidates across ordinary NATs. Deployments can set
`globalThis.HYPERSTREAM_RTC_CONFIGURATION` before the modules load to provide
short-lived TURN credentials or a different ICE policy. STUN does not replace
TURN for restrictive NATs and firewalls.

For a public deployment:

- Serve the pages and direct device route over HTTPS.
- Preserve the literal `/~hyperstream@1.0/<operation>` route.
- Route every request for a session to the same HyperBEAM node.
- Reject oversized fixed-length and chunked bodies before HyperBEAM buffers
  them.
- Rate-limit `transport-key`, `create`, `join`, and `signal`.
- Disable request and response body logging at the edge even though operation
  bodies are sealed.
- Use `store-all-signed=false` on a dedicated Hyperstream node, or accept that a
  stock default node may persist encrypted signed requests at poll frequency.
- Keep `Cache-Control: no-store` and omit credentials from metadata.
- Provision relay-only TURN or an SFU separately when network reachability,
  scale, or peer IP privacy requires it.

Coordination state and the `hs1` key are local to one Erlang node. A restart
rotates the key and loses sessions; clients must fetch the new key, rejoin, and
renegotiate. This sealing prevents incidental plaintext persistence but is not
end-to-end secrecy from the node operator.

Recording is intentionally not simulated. A media adapter must first write
finalized immutable segments to a configured HyperBEAM store, then an
allowlisted signer-authenticated owner can link those objects with `record`.
The device writes deterministic replay manifests subject to per-session segment
and aggregate descriptor-byte limits, but the operator remains responsible for
store capacity, retention, and garbage collection.
