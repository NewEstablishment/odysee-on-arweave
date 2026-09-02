# Decision: private playlists use owner-bound encrypted snapshots

## Issue

Playlists need durable cross-session storage without exposing their title,
description, thumbnail, tags, profile metadata, or ordered item locators before
the owner chooses to publish them. Storing them in user preferences would mix
independent state domains, while adding a playlist write device would duplicate
the generic committed-message and reference contracts.

## Decision

- New and copied user playlists default private.
- A private version is a generic committed
  `odysee-private-playlist@1.0` message containing only a `weavemail@1.0`
  envelope and its cryptographic metadata. The decrypted
  `odysee-private-playlist-payload@1.0` value carries the normal complete
  playlist snapshot.
- The browser seals and opens with the shared WeaveMail client primitives
  (vendored from permaweb/PermawebOS-Browser, `ui/util/weavemail.ts`): a fresh
  AES-256-GCM content key per snapshot, RSA-OAEP/SHA-256 wrapped to the
  recipient wallet. The recipient is the owner's own hosted wallet, exported
  in-session through the cookie-authenticated `~secret@1.0/export` boundary and
  held in memory only. No key is generated or persisted in the browser, there
  is no private-playlist or WeaveMail HTTP device, and no plaintext or content
  key is sent to the node.
- The generic `reference@1.0` init commitment remains the playlist's stable
  route. Reference messages bind `playlist-owner` to their exact verified
  committer. Discovery is owner-scoped, and readers verify the exact reference
  and ciphertext commitments before asking the authenticated boundary to open
  the snapshot.
- Making a private playlist public writes a plaintext
  `odysee-playlist@1.0` snapshot and advances the existing reference. The UI
  requires explicit irreversible confirmation. Public-to-private is rejected
  because an immutable public snapshot cannot be made secret.
- Queue, Watch Later, Favorites, and failed-save recovery drafts remain local.

## Consequences

Private playlist contents remain confidential at rest and across ordinary
query/index paths while preserving the same append-only history and stable URL
model as public playlists. A public conversion does not create a second
playlist identity, and no private key, unwrapped content key, or plaintext
enters public storage. Anyone can observe that the owner has a reference and
encrypted snapshot, but only the owner wallet can recover its contents. Because
identity and recipient key are the same wallet, recovery follows the account:
clearing browser data loses nothing once the owner signs in again, and any
device that can authenticate as the owner (cookie today, portable providers
later) opens the same snapshots. The node operator who hosts the wallet can
derive the key, exactly as for the account itself. While private playlists are
open, the wallet keyfile is present in page memory, so a script running on the
app origin could read it; that origin already holds the cookie that controls
the account, so this widens the blast radius of a compromise (the key outlives
cookie rotation) rather than creating a new one. The wallet export must always
be requested with `accept-bundle: true`: HyperBEAM offloads the nested
messages of an unbundled reply into the node's public store (`hb_link`), which
would publish the wallet record at its content id, while a bundled reply
writes nothing (verified against a live node). Experimental snapshots
created on this branch before this format are intentionally rejected; they are
test data, not a supported persisted format.
