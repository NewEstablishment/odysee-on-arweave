# Decision: private preferences use encrypted snapshots and generic references

## Issue

User settings need a stable, reloadable head without making private values
public, restoring wallet sync, or turning an index into mutable authority. A
plain committed message would expose settings. An application device that owns
storage and revisions would also violate the generic-write architecture.

## Decision

- The persisted value is a cookie-signed immutable
  `odysee-preferences@1.0` snapshot written through
  `/id?0.%21=true&committers=all`.
- Snapshot payloads contain only an authenticated-encryption envelope:
  `aes-256-gcm`, key version, owner, IV, ciphertext, tag, and update time.
  Preference plaintext, cookie values, and hosted-wallet material are never
  committed.
- The pinned generic `reference@1.0` init commitment is the stable preference
  identity. A successful update writes a new snapshot and a strictly newer
  same-owner set message. Earlier snapshots remain exactly readable.
- Readers use `query@1.0` only for reference locators, hydrate and verify every
  exact message, derive authority from commitment committers, and reject
  foreign writers, foreign-owned snapshots, stale updates, and ambiguous
  equal-time updates. If one owner has duplicate init messages, the oldest
  timestamp and then lowest message ID chooses the canonical root.
- The narrow `odysee-preference@1.0` device is an authenticated cryptographic
  boundary only. It obtains the caller's hosted wallet through
  `secret@1.0/export`, derives an owner-bound encryption key, and seals or
  opens ciphertext for that same authenticated owner. It stores no preference
  state and all responses are `no-store, private`.
- The frontend keeps one SDK-shaped `preference_get` / `preference_set`
  integration. When HyperBEAM is configured it does not fall back to the
  legacy daemon on native errors.
- Application startup first proves that the cookie owner committed the exact
  active profile, establishes a native Redux user, and immediately hydrates
  shared preferences. Native Retry repeats that read rather than invoking
  legacy wallet sync.
- Snapshot and reference writes are acknowledged by exact commitment/owner
  readback. The query listener is eventually consistent, so discovery of the
  just-written reference is not part of the synchronous save transaction.
- Native shared preferences deliberately contain only settings, tags, welcome
  state, analytics sharing choice, and announcement state. Native follows are
  authoritative for subscriptions, moderation owns blocked state, and local
  drafts/private collections remain local; the preference blob must not shadow
  those domains.

## Consequences

Preference contents are private at rest in public message stores, while their
history and current-head movement remain append-only and auditable. Recovery
currently inherits the cookie account's limitation: the same hosted wallet
must be available on the serving node, so cross-node/device recovery requires
a future portable identity or secret-sync contract.
