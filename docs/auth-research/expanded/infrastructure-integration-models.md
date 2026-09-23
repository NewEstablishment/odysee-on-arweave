# How alternative auth can fit Odysee on HyperBEAM

Date: 2026-09-21. Proposed integration models, not implemented endpoints or approved changes. Current code evidence: [native audit](../native-auth-audit.md), `src/hb_odysee_node.erl:142`, `src/dev_odysee_preference.erl:134`, and `odysee-frontend/ui/util/hyperbeam.ts:2652`.

## Preserve the product path

```text
Static manifest browser
  -> narrowly authenticated request boundary
  -> generic committed /id write signed by the existing account wallet
  -> query locators + exact immutable hydration
```

The existing account wallet is not the external login credential. A candidate must state which boundary changes: authentication evidence, private account binding, custody, session policy, native authority verification, or encryption. Changing one does not implicitly solve the others.

The browser's legacy-fetch guard remains in place. An intentional new authentication-provider integration would need a reviewed allowlist/CSP/origin/callback boundary; it is not permission for product components to resume calling legacy APIs. External JavaScript, wallet extensions and remotely served signer frames add code-delivery trust that must be named. No client secret belongs in a static manifest.

## Model 1 — proof adapter to the current hosted wallet

Suitable families: legacy auth bridge, native magic link/code, OIDC, passkey, linked external wallet, ATProto/Nostr/IndieAuth login, and selected externally verifiable identity systems.

1. Create a private authentication transaction with a random challenge, intended action, allowed destination, expiry and browser/session binding.
2. Authenticate through the selected mechanism; validate its own origin/audience/issuer/proof rules, not a generic boolean supplied by the browser.
3. Map the verified issuer-scoped identity to an existing private native account binding. Linking an existing cookie-owned account requires proof of its current owner too.
4. Establish a revocable per-device session authorized to that wallet. An external provider token is not written into any product message.
5. The generic request-auth/signing boundary authorizes and signs ordinary native content; existing same-owner projections remain unchanged.
6. Logout invalidates the session; recovery obtains a new authorized session for the same wallet. Custody backup/failover is an independent dependency.

New private state would include bindings, sessions, challenges and replay consumption. Suggested fields are conceptual, not a schema decision: account identifier, credential type/issuer/subject or public-key handle, wallet locator, credential status, session identifier/expiry/revocation generation, purpose, audience and creation/consumption state. Avoid exposing this mapping through public `query` indexes.

Fits the present content model with the least authority disruption, but remains hosted custody. A stateless proof verifier can validate a signature, yet account linking, revocation and one-time redemption still need authoritative state. Query-index eventual consistency is not sufficient for atomic consumption or account enrollment.

## Model 2 — external proof plus node-scoped handoff

Useful when the auth origin and serving-node origin differ. The user authenticates at a trusted origin; an audience-bound, short-lived, single-use handoff permits only the selected approved node to issue a local session. The browser receives no reusable global key as a handoff token.

The destination must have authorized access to the same existing wallet via approved private custody, or a policy-constrained signer. Handoff alone does not move the wallet. Validate destination admission before sending credentials, and bind redemption to the initiating browser to avoid login CSRF. Specify logout/revocation across issuers and nodes. An arbitrary community node should not be able to register itself as a full-authority destination.

This is a possible narrow auth transport, not required SSR or a product API proxy. OAuth-like mechanisms may supply a reviewed protocol foundation; do not invent cryptography or claim the architecture already implements federation.

## Model 3 — distributed unlock of an encrypted existing wallet

Suitable families: threshold recovery/OPRF, selected decentralized key-release networks, PRF-wrapped backup, or independently managed recovery shares.

1. On explicit authenticated enrollment, preserve the exact existing serialized wallet and encrypt it in a versioned envelope using established reviewed primitives.
2. Distribute only wrapping-key shares or access-controlled encrypted recovery material under a specified threshold/policy. Ordinary public content remains untouched.
3. A new device authenticates and obtains enough authorized decryption capability to recover the original wallet.
4. Import into a trusted custody node or use a separately approved browser signer; prove old preferences and playlist envelopes still decrypt.
5. Mint a revocable session and clear transient plaintext key material as far as the runtime permits.

This route avoids demanding threshold RSA signing from a network that only supports elliptic curves: it may protect an arbitrary encrypted secret rather than sign product messages. It is only viable where the actual system supports arbitrary secret recovery/wrapping, not because its marketing says multi-chain. Payload sizes, AEAD formats, binding, rollback, provider quorum and recovery authentication require concrete validation.

After recovery the full wallet exists somewhere. That party can potentially copy it; changing the unlock policy cannot revoke a copied wallet. A vendor enclave that sees the full secret is not equivalent to threshold signing where no party reconstructs it. Do not replace existing WeaveMail playlist primitives while prototyping a separate wallet-backup envelope.

## Model 4 — remote policy-constrained signing and decryption

An approved signer holds the existing wallet; serving nodes submit authenticated, intention-bound signing requests rather than receive the wallet. This can reduce key distribution. It does not remove signer availability, censorship or compromise risk.

Must demonstrate native commitment canonicalization/signature compatibility, per-account authority, exact message binding, nonce/replay rules and policy enforcement. A generic request that can sign any bytes is dangerous without clear scope. The existing private-playlist path exports a JWK and performs browser decryption; a strictly non-exportable remote signer would need an explicitly redesigned decryption/wrapping interface, not just a signing adapter. Preference derivation also depends on key material unavailable to a signing-only API.

## Model 5 — user-held compatible signer

An extension, wallet app or native client signs the exact generic message. Product verification must support its commitment format, and the stored owner must be the intended current signer. Signing an Arweave data item is not automatically identical to signing the HyperBEAM HTTP/message envelope used here.

An existing user can use this model only if it controls the original key or a versioned authorization transition is introduced. Standard signatures do not restore the original encrypted preferences or private playlist keys. Avoid importing a real creator key into an experimental extension to test compatibility; use synthetic fixtures.

## Model 6 — stable account/controller plus scoped signers

Suitable inspirations: UCAN/zcap, DID/KERI rotation, chain smart accounts, Internet Identity delegation and explicit native account references.

The account becomes an authority root distinct from a specific current signing key. Grants authorize devices/nodes for defined operations; revocation/rotation updates the authority state. This can express creator assistants, narrowly scoped TV access and multi-device access, but current same-committer projectors do not implement it.

An implementation proposal must enumerate every affected verifier: profiles, upload revisions, comments, reactions, subscriptions, playlist/preferences references, controls and historical importer provenance. Specify which state establishes authorization at the time of an event, how forks or stale replicas are handled, and which old writes remain valid. Do not bless all messages containing a claimed account ID. Key wrapping and recovery remain a separate encryption contract.

## Shared prototype fixture and pass/fail gates

Use two disposable HTTPS origins, two synthetic accounts and non-sensitive fixtures. Do not reuse or restart shared nodes. Proposed checks:

- Account A writes an upload, comment edit, follow and private playlist/settings before enrollment.
- Enrollment binds the new method without changing A's committer. Account B cannot link it or recover A.
- Login on another browser/node preserves authority and decrypts the old exact snapshots with original node unavailable.
- Same-user concurrent enrollment produces one binding or a clear retryable failure, not two wallets.
- Lost response and duplicate callback do not consume the account or apply the intended content action twice.
- Replay, wrong origin/audience, expired proof, swapped transaction and provider-account reassignment fail safely.
- Device revoke, factor removal, issuer outage, storage restore and partition each have an explicit outcome.
- Disable the vendor/issuer/recovery service after setup. Distinguish continued session use, new login, export and total recovery; these are four different availability claims.
- No secret leaves a private intended boundary, including nested response serialization, caches, logs and public immutable messages.
- Measure user completion and time to action with the [adoption plan](adoption-and-user-journeys.md), not just API success.

## Questions every vendor or protocol advocate must answer

1. Can it preserve an existing RSA wallet and exact serialized recovery bytes, or only generate its own key types?
2. Who can obtain the full key, approve a signature, alter recovery policy, or replace a credential?
3. Which independent failures or collusions cause takeover or lockout? How independent are the operators really?
4. Can recovery succeed after the company, authentication provider or initial node disappears—not merely export beforehand?
5. What code must the user trust at login/unlock, and which origin serves it?
6. Is claimed portability about the public identifier, credentials, signing authority, encrypted data, or all four?
7. What must we implement outside the SDK: issuer, database, relay, verifier, prover, chain indexer, enclave, backups, email operations?
8. Which dependencies are audited, licensed for self-hosting and currently maintained? What evidence is still unavailable?

The topic reports map concrete systems to these models. This prevents a protocol name from concealing the actual integration and operational work.
