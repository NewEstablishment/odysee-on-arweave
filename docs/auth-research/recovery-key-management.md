# Recovery, custody and key management

Research date: 2026-09-21. Proposal, not an implemented protocol or production security certification. Read alongside [native audit](native-auth-audit.md), [email](email-auth-options.md) and [passkeys/devices](passkeys-device-options.md).

## What must survive a login change

The current account is more than a profile. Existing signed content and revision chains bind authority to a verified committer. Preferences bind encryption to the hosted wallet's serialized key material and address (`src/dev_odysee_preference.erl:134`); private playlists wrap their content key to the hosted RSA wallet using WeaveMail (`decisions/private-playlists.md`). Recreating the display name or obtaining another provider token does not restore that authority or decryption ability.

`decisions/cookie-identity-persistence.md` describes private non-volatile wallet storage for restart continuity. It explicitly leaves lost-cookie recovery, lost private-store recovery, multi-device login and TEE custody unresolved. Public object replication alone is not a private-wallet backup.

Four operations must have separate specifications:

| Operation | Meaning | Consequence here |
| --- | --- | --- |
| Session revocation | Stop a browser/device using hosted authority | Requires server-enforced invalidation, not hiding the user in Redux |
| Recovery/restoration | Regain the existing wallet | Least disruptive to exact-committer chains and encrypted history |
| Key rotation | Replace a signing or encryption key | Needs explicit authority transition; a new profile pointer is insufficient |
| Account transfer | Authorize another controller | Product/security policy, not automatic email-string matching |

The distinction is an inference from the repository's authority/encryption contracts. Revoking a cookie cannot revoke a private key already exported to an attacker. Already disclosed plaintext and historical ciphertext encrypted to a compromised key cannot be made secret again.

## Practical alternatives

### A. Privately backed-up hosted wallet — closest to current architecture

Retain one account wallet; authenticate users through enrolled methods and issue distinct revocable sessions. Keep the identity-to-wallet binding, session registry and encrypted wallet backups private. Replicate only between explicitly trusted operated nodes, with authenticated transport and audited authorization. A TEE can constrain operator access under its threat assumptions; it does not automatically supply backup availability, account consistency, attestation policy, rollback resistance or revocation.

Before implementation, specify a single account-creation authority or conflict-safe enrollment protocol. Two nodes receiving the same first login must not independently mint different wallets. Define behavior under partition: refusing enrollment/recovery can be safer than silently splitting identity. Existing `secret` primitives are candidates for review, not a validated turnkey cluster; see the native audit.

Operator custody must be stated honestly: unless a separately verified protection prevents it, an operator holding usable wallet material can sign and decrypt. Untrusted community read nodes should not receive those keys. Static manifest delivery still needs origin/code integrity; malicious served JavaScript can misuse an authenticated session or in-memory exported wallet.

### B. User-held encrypted recovery kit — strongest near-term complement to investigate

Export a versioned encrypted backup of the exact necessary wallet material and account metadata, protected by an independently generated high-entropy recovery secret. Make users verify a restore before treating setup as complete. Store neither the recovery secret nor unencrypted wallet in public messages, localStorage, analytics or test artifacts. Define how a restored wallet gains a new session on an approved node and how old sessions are invalidated.

Preserve exact wallet serialization or explicitly migrate the preference KDF: the same mathematical RSA key with different serialized bytes may derive a different current preference key. Test old preference and private-playlist ciphertext, not just address equality. Backup integrity and version handling must reject malformed/tampered packages before changing account state.

A random offline recovery secret can avoid password guessing, but loss/theft becomes a user-support problem. Distinguish a one-use server recovery code from a reusable offline decryption key. Consuming a server code does not invalidate a copied encryption secret or wallet backup. NIST documents distinct recovery methods and authenticator lifecycle requirements; use it as a benchmark, not a claim that this product is certified. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)

### C. Password-protected backup / password login

A human password is not sufficient random wallet entropy. If offered, use a reviewed password authentication system and independently random wallet, not wallet derivation from password, email, OIDC subject or a fixed public salt. For encrypted backups, a memory-hard KDF with a unique salt raises guessing cost but cannot make a weak password strong; benchmark parameters on supported devices and version them. Public immutable backup ciphertext creates a durable offline guessing target. [Argon2 RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)

OPAQUE is a standardized augmented password-authenticated key exchange worth evaluating if password login is a requirement. It does not by itself define this application's wallet backup, account linking, recovery, revocation or cross-node consistency; it requires a suitable implementation and security review. Do not interpret it as eliminating all dictionary attacks after all relevant secrets are compromised. [OPAQUE RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)

### D. Cloud backup

An encrypted recovery package can live in user-selected cloud storage, including the Google Drive idea raised in the meeting. This is a storage option, not a second identity proof. If the same provider compromise unlocks both backup and its decryption secret, recovery is not independent. Assess provider deletion, account suspension, OAuth scope minimization, retention and alternate export. No cloud SDK or live account was tested in this pass.

### E. Guardians / split recovery / threshold custody

These solve different problems. Splitting a recovery secret allows a quorum to reconstruct it; a threshold signing scheme can produce signatures without reconstructing the full signing key. Neither automatically provides old data decryption or native authority migration. Guardians need explicit enrollment, independent failure domains, delayed recovery, notification, cancellation, replacement and collusion policy.

FROST specifies threshold Schnorr signatures. It is not a drop-in threshold implementation for the existing RSA signing/envelope wallet. Adopting it would require cryptographic and verifier compatibility work, not just a UI setting. [FROST RFC 9591](https://www.rfc-editor.org/rfc/rfc9591.html)

Treat guardians and threshold custody as later work unless the team accepts their availability, support and audit cost. Avoid hand-rolled secret sharing or threshold protocols.

### F. Stable account with delegated device keys — larger architectural option

Separate a durable account/controller identity from device signing keys and encryption keys. This could support scoped sessions, replaceable devices and explicit controller recovery without giving every device the root wallet. However, current revision/reference projectors require the same verified committer. Delegation therefore needs a versioned authorization contract adopted consistently by every write and read verifier; it cannot be slipped into profile hydration.

Specify grant scope, expiry, revocation ordering, fork handling, trusted clock/sequence behavior, offline operation and historical validation. Revocation must not erase valid historical authorship, but stale readers must not accept new unauthorized writes. Separately define encrypted data-key wrapping and recovery. This is a future architecture proposal, not present support.

### G. Additional factors and institutional recovery

TOTP, security keys, passkeys and device approval can strengthen sensitive operations. SMS/voice bring telecom-account and number-reassignment risks; avoid making them the sole creator-account recovery path. A second factor is not a backup of the signing wallet. Existing-device approval cannot recover an account after every enrolled device is lost. See the passkey/device report and [NIST authenticator guidance](https://pages.nist.gov/800-63-4/sp800-63b.html).

Support/admin recovery is an explicit impersonation/transfer power. If offered, define evidence, independent approval, delay, notifications and auditability; never add an undocumented override. Legacy creator verification is a distinct ownership-migration contract: access to an email/Google account alone does not prove control of an old LBRY channel.

## Required experiments before choosing

All are proposed tests, not executions in this research pass.

1. Restore on a disposable node with the original node absent: same wallet address, owned revisions still editable, existing private playlists and preferences decrypt.
2. Enroll the same external identity concurrently on two nodes; no duplicate wallets or silent account merge.
3. Revoke one device; replay its captured credential against each operated node; unrelated devices retain access. Test partition/reconnect and stale state explicitly.
4. Restore backup made before later content writes; recover latest valid authoritative state without rolling back account/revocation metadata.
5. Exercise stolen cookie, stolen wallet, compromised provider and lost-all-devices separately; document which attacks remain recoverable and which historical secrets are already exposed.
6. Link/unlink Google, email and passkey on an existing cookie-owned account. Never replace the wallet or auto-merge accounts on an email match.
7. Test changed wallet serialization, old encryption versions, corrupt/wrong-owner backup and interrupted recovery. Failure must preserve the original usable account.
8. Review all wallet export/import/sync paths for public cache/message leakage, logging, CSRF, session fixation, origin policy and authorization before live use.

## Recommended investigation order

First specify privately persisted account binding, per-device sessions and revocation. Next demonstrate same-wallet restoration plus private-data recovery. Then evaluate a passkey or email method as an alternative way to authenticate to that same binding, coordinated with Ayush's Google work. Keep delegated-key identity, social recovery, threshold custody and cloud convenience integrations as explicit later decisions. No authentication method should be called production-ready until its recovery and abuse paths are also accepted.
