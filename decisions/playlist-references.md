# Decision: stable playlists use canonical `reference@1.0`

## Issue

An immutable playlist snapshot is a correct content object but a poor public
identity: every reorder or metadata update produces a new committed ID and
breaks the existing share URL. Reintroducing LBRY collection claims, a custom
Odysee reference device, or an in-place mutable index would conflict with the
store-first and generic-write contracts.

## Decision

- Playlist content remains a complete immutable `odysee-playlist@1.0` message.
- Initial publish writes the snapshot and then a canonical `reference@1.0` init.
  The init commitment ID is the stable public playlist ID.
- Republish writes a new snapshot and then a set carrying `reference-id`, the
  new snapshot ID as `reference-value`, and a strictly greater timestamp.
- The cookie committer that signed the init owns the Odysee playlist reference.
  Profile fields are discovery/display metadata and cannot grant authority.
- Discovery returns init/set locators. Readers hydrate and verify every exact
  commitment, reject foreign or stale sets, and separately verify that the
  selected snapshot has the same owner/profile binding.
- Equal-timestamp conflicts fail closed in the local projection because the
  match index does not expose the canonical Arweave position tie-breaker.
- If the snapshot write succeeds but the reference write fails, the previous
  head remains valid and the new immutable snapshot is merely unreferenced.

The canonical device is a pinned external OTP dependency. A minimal tracked
upstream patch keeps reserved message verification and committer operations on
the original reference record; it does not add product behavior to the device.

## Consequences

Playlist links survive publish, edit, and reorder while every historical state
remains independently addressable. Query indexes still locate candidates but do
not determine ownership or current state. Queue, Watch Later, Favorites, and
unpublished drafts remain local, and public deletion is a separate future event
contract.
