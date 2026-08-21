# Decision: persist cookie-owned hosted identities privately

## Context

`cookie@1.0` puts a stable secret in the browser, but `~secret@1.0` previously
kept the wallet associated with that secret only in memory. After a node
restart the same cookie therefore minted a different wallet and committer.
Existing comments, reactions, playlists, and subscriptions still verified, but
their owner could no longer append a valid edit, removal, or reference update.

## Decision

The checked-in cookie deployment sets `secret-default-persist` to
`non-volatile`. A narrow upstream patch makes that default configurable while
preserving HyperBEAM's existing `in-memory` default for other deployments. A
new wallet is written to the node's private store and warmed in memory; after a
restart it is recovered by the cookie-derived secret key ID.

The private wallet store is credential storage. It must never be published,
committed, copied into the manifest, or treated as public message data.

## Consequences

- The same browser cookie keeps the same committer across node restarts.
- Append-only edits, deletes, reaction toggles, playlist updates, and follows
  continue to pass exact same-owner checks after restart.
- Clearing the browser cookie or losing the node's private store still loses
  access. Multi-device login, export/recovery, TEE custody, and account
  references remain separate product/security decisions.
- This does not authorize profiles or local storage. Authority remains the
  committer of each exact verified message.
