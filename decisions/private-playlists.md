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
- The browser implements the WeaveMail 1.0 envelope format directly with
  WebCrypto. It generates a fresh AES-256-GCM content key per snapshot and
  wraps it with a browser RSA-OAEP/SHA-256 public key. The RSA key pair is
  generated once per verified native cookie owner and persisted as CryptoKeys
  in IndexedDB; the private key is non-exportable. There is no
  private-playlist gateway or WeaveMail HTTP device, and no plaintext or key
  material is sent to the node.
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
encrypted snapshot, but only the browser holding the matching key can recover
its contents. Clearing browser data or moving to another browser loses access
until a key backup/recovery design exists. Experimental snapshots created on
this branch before this browser-only format are intentionally rejected; they
are test data, not a supported persisted format.
