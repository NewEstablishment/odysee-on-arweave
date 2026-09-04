# Native committed messages: the envelope contract

Every native feature (uploads, comments, reactions, subscriptions,
playlists) is built from generic committed messages written with
`POST /id?!=true&committers=all` and discovered with `~query@1.0`. There are
no app devices (see `decisions/store-first-no-app-devices.md`) and no
mutable state: change is modeled as append-only revision chains, projected
client-side by `ui/util/revisionedMessage.ts`.

## Envelope fields

Written kebab-case on the wire; readers accept kebab and snake aliases
forever (committed messages are immutable, historical shapes never go away).

| Field | Meaning |
|---|---|
| `schema` | The family tag, e.g. `odysee-reaction@1.0`. The query selector. |
| `type` | Legacy duplicate of the family (1:1 with `schema`). Readers accept it; new code should not branch on it. |
| `signature-scope` | The signing domain, e.g. `native-reaction-v1`. Pins what the commitment covers. |
| `<feature>-ref` | The chain identity revisions point at. Referent DIFFERS per family, see below. |
| `version-ref` | This message's own version identity (random, or derived per family). |
| `revision` | 0 on a root, `previous + 1` on a revision. |
| `revision-of` | On revisions: the chain ref of the root. Absent on roots. |
| `previous-version` | On revisions: the predecessor's `version-ref` (or id where a family predates `version-ref`). |
| `state` / `operation` | The per-family state machine, e.g. `set/active`, `remove/removed`, `follow/unfollow`, `edit/delete`. |
| `event-timestamp` (or `created-at`/`updated-at`) | Event time; ordering is time, then `revision`, then message id. |

## Chain rules (enforced by the kernel)

- A root has `revision = 0`, no `revision-of`, no `previous-version`.
- A revision names its root (`revision-of`), its predecessor
  (`previous-version`), increments `revision` by one, and preserves the
  root's owner and the family's immutable fields.
- At most one legal successor may exist per step. A fork (two competing
  successors from the same owner) stops the chain at the last unforked
  item: a forged branch can never take over a chain.
- An owner signing two different semantics under one version identity is an
  equivocation. The blast radius is the family's `equivocation` policy:
  `drop-version` (reactions), `poison-ref` (subscriptions), `none`
  (comments). These differ historically; unifying them is a pending,
  deliberate decision.

## Per-family chain refs (the divergence to be aware of)

| Family | Chain ref (`revision-of` referent) |
|---|---|
| `odysee-comment@1.0` | the root comment id |
| `odysee-reaction@1.0` | `reaction-ref`, random per (owner, target) |
| `odysee-subscription@1.0` | `subscription-ref` = `<owner>.<channel-ref>`, deterministic |
| `odysee-playlist@1.0` | none: immutable snapshots, every save is a new message |
| `odysee-private-playlist@1.0` | none: owner-bound encrypted immutable snapshots, every save is a new message |
| `odysee-upload@1.0` | `version-ref`, random per revision; edit appends metadata, delete appends a tombstone |

## Identity and verification

The committer is the cookie account's wallet; readers verify the
commitment (`hb_message` semantics via the node) and trust only committed
keys. `owner` in projections is always the verified committer, never a
self-declared field.

Private playlist snapshots contain a `weavemail@1.0` envelope only: ciphertext,
an RSA-OAEP-wrapped random AES-256-GCM key, IV, and authentication tag. Their
decrypted payload uses the ordinary playlist fields under the separate
`odysee-private-playlist-payload@1.0` signing domain. The browser performs
encryption and decryption with the shared WeaveMail primitives, keyed to the
verified owner's hosted wallet exported through `~secret@1.0/export`. The node
only commits and serves the generic ciphertext and reference messages; no
private-playlist or WeaveMail HTTP device participates.
