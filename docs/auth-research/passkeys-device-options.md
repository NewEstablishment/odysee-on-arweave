# Passkeys, device approval, wallets and session binding

Research date: 2026-09-21. Status: exploration, not an implementation decision or security sign-off. No authentication code, accounts, services, keys or configuration were changed. Browser/provider claims below are documentary evidence, not a tested compatibility matrix. The security-review skill informed the threat model and acceptance criteria.

## Conclusion

The most practical option in this group is **passkey authentication linked to the existing hosted account**, with multiple registered credentials and an independent recovery route. It can complement Ayush's OAuth work, not replace it. Investigate device approval next for adding a browser or TV. Treat passkey-derived encryption, direct external-wallet signing and arbitrary community-node login as separate architecture projects.

Four questions must stay separate:

1. Which credential proves this login is authorized?
2. Which existing account/committer does that credential authorize?
3. Where does the existing message-signing and decryption key live?
4. Which service checks session expiry/revocation and may issue another session?

A successful WebAuthn or wallet signature answers the first question, not all four. Device pairing transfers approval; it does not establish backup or recovery by itself.

## Local constraints that make this consequential

This project's native writes are generic committed messages. Ownership is the verified committer; a profile label or a new authentication public key is not interchangeable with that identity. Two inspected boundaries demonstrate the additional encryption constraint:

- `src/dev_odysee_preference.erl`: `authenticated_wallet/3` uses the secret export boundary. `encryption_key/1` hashes the domain, address and serialized wallet material. Research implication: preserving a mathematically equivalent signing key may not be enough if import changes the serialized wallet representation. Recovery must decrypt an old real fixture, not merely compare addresses.
- `odysee-frontend/ui/util/weavemail.ts`: private playlists use an RSA recipient JWK/public modulus and private-key decryption. A WebAuthn credential or Ethereum private key is not that RSA decryption key.

Therefore the initial design should authenticate access to the **same** existing hosted wallet. Replacing the wallet requires an explicit authority-transition protocol and private-data migration/recovery design. Do not change author/owner checks to accept an arbitrary claimed account ID.

## Option map

| Option | What it can provide | What it cannot provide alone | Suggested position |
| --- | --- | --- | --- |
| Passkey linked to hosted account | Phishing-resistant login and step-up | Wallet custody, cross-node key availability, lost-all-factors recovery | First exploration |
| Multiple passkeys/security keys | Redundant authenticators, stronger creator/admin access | Recovery if all are lost; session revocation by deleting a device copy | Part of passkey design |
| FIDO cross-device authentication | Use phone's passkey on another nearby device | Permanent wallet transfer or arbitrary RP-domain portability | Prefer built-in transport |
| Approved-device QR/code flow | Add device/TV using an existing authenticated device | Recovery when no device remains; automatic phishing resistance | Second exploration |
| Passkey PRF wrapping an existing wallet | Client-side unlocking of an encrypted wallet envelope | Universal provider support, automatic rewrapping to new credentials | Isolated experiment only |
| External-wallet login | Prove control of a linked wallet | Ownership of an unlinked native account or old private-data decryption | Optional advanced login |
| Direct external-wallet message signing | Potential portable self-custody | Compatibility with current commitments, envelope algorithms and UX | Larger contract review |
| Device Bound Session Credentials | Reduce usefulness of exfiltrated cookies | Login identity, key backup, logout design or cross-device recovery | Optional later hardening |

## 1. Passkeys linked to the existing account

WebAuthn Level 3 became a W3C Recommendation on 25 August 2026; descriptions calling it only a draft are now stale. A passkey is an authenticator credential used in registration/assertion ceremonies, not an exportable arbitrary-message signing API. The standard defines RP/origin binding and optional PRF outputs. [W3C Level 3](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/)

Proposed fit, not existing behavior:

- While authenticated to an existing account, register a new credential after fresh verification. Privately bind credential ID/public key/user handle to that account, not a display name.
- Verify future assertions at a narrow authentication boundary; create a fresh revocable session authorized to the existing hosted wallet.
- Keep registration, removal, recovery and factor linking distinct from generic product writes. Never publish challenges, sessions, recovery material or credential-account mappings merely because product content is append-only.
- Support more than one registered credential. Removing a credential server-side and revoking existing sessions are separate actions.
- Require explicit step-up for adding a factor, exporting wallet material, changing recovery methods or authorizing a node. A session obtained through a weak fallback must not silently gain stronger recovery authority.

Server checks include challenge freshness/single use, signature, expected RP ID hash and exact allowed origin, user presence and required user verification, account binding, and policy for credential backup state. Google documents the server-side verification boundary. [Server authentication](https://developers.google.com/identity/passkeys/developer-guides/server-authentication)

Security analysis: passkeys reduce credential phishing; they do not neutralize same-origin malicious JavaScript, a compromised session issuer or a malicious hosted-wallet operator. Treat zero or non-monotonic authenticator counters carefully for synced credentials rather than assuming every login has a globally increasing hardware counter.

## 2. Domain scope: operated nodes versus community nodes

WebAuthn normally binds a credential to an RP domain or permitted domain suffix. Related Origin Requests (ROR) permit selected additional origins via the RP's HTTPS `/.well-known/webauthn` document. They are a controlled extension, not wildcard login for arbitrary nodes. ROR clients have bounded processing; do not design an unlimited node registry around it. [W3C related-origin contract](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/#sctn-related-origins)

Deployment choices to compare:

1. **Operated common-origin entry point:** authenticate at a stable origin, with operated nodes behind it. Best compatibility, but availability and trust are concentrated at that origin and its account/key services.
2. **Controlled related domains:** one RP ID and deliberately admitted origins, with shared credential/account state. Every admitted origin expands the authentication trust boundary. Google's example explicitly shares a credential database. [ROR deployment guidance](https://web.dev/articles/webauthn-related-origin-requests)
3. **Central authentication followed by node-specific handoff:** unrelated nodes receive narrowly scoped, short-lived authorization, not the global wallet secret. This needs explicit issuer/audience/trust/revocation rules and actual signer integration; it is not already supplied by passkeys.
4. **Separate credentials per node linked to one account:** requires authenticated enrollment plus shared account authority. Linking cannot be based on matching handles/email alone. Offline or hostile nodes still need a defined authority/revocation model.
5. **Client-owned portable signer:** potentially avoids distributing custody to nodes, but changes the current write/crypto boundary and requires a separately reviewed design.

Important inference: allowing any community node to serve the wallet-unlocking frontend and receive exported private material is not safe merely because authentication used a passkey. Trusted code delivery/origin is a separate requirement. Keep community read-serving distinct from eligibility to host custody or login.

## 3. Synced, device-bound and hybrid passkeys

Synced passkeys are available through the user's credential-provider ecosystem; device-bound credentials remain tied to their authenticator. FIDO's cross-device authentication uses a phone credential for another device and checks proximity using Bluetooth, with additional cryptographic protection for the transport. This is distinct from a website inventing its own QR login. [FIDO passkeys](https://fidoalliance.org/passkeys/)

Google documents passkeys and cross-device authentication across Chrome platforms, including Google Password Manager synchronization. That does not promise arbitrary provider-to-provider migration or availability when the provider account is inaccessible. [Supported environments](https://developers.google.com/identity/passkeys/supported-environments)

Proposed tests must distinguish: synced credential on a second device; nearby-phone authentication without syncing; separate hardware security key; enrolling a genuinely new credential. These paths can look similar to users but have different recovery dependencies. Offer a second credential or recovery kit before a user deletes their last usable factor.

## 4. PRF encryption: promising, not a drop-in recovery system

The WebAuthn PRF extension returns credential-associated 32-byte outputs for supplied inputs. Availability is optional; output is not guaranteed during registration. It must not be confused with a stable value obtained by hashing ordinary assertion signatures. [W3C PRF contract](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/#prf-extension)

Potential experiment: preserve an existing native wallet in an authenticated encrypted envelope, with a wrapping key derived through a reviewed KDF from the PRF result. This is a design hypothesis, not permission to reimplement WeaveMail or change native playlist encryption.

Research blockers:

- A newly registered credential has its own PRF secret. Adding it needs an authorized rewrap of the existing wallet, not generation of a new account.
- Test same-credential PRF continuity after sync, provider restore and cross-device use. Do not infer it from a successful ordinary login.
- Losing all usable credentials and recovery wrappers loses access unless an operator retains escrow; escrow changes the custody claim.
- Removing a wrapper does not revoke a wallet already decrypted/copied. Native key compromise still needs authority rotation, not just factor deletion.
- XSS or malicious delivered JavaScript can use/export plaintext after successful unlock. Browser cryptography does not make an untrusted frontend safe.
- Preserve exact historical preference decryption; the current wallet-serialization-derived key is a particular migration hazard.

Apple announced PRF and ROR in Safari 18. However, an upstream WebKit report documents incorrect CTAP security-key PRF output in Safari 26.4, and another reports absent output for a particular biometric key on 26.5. These reports are interoperability warnings, not proof every current Safari combination fails. [Safari 18 features](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/), [WebKit issue 311099](https://bugs.webkit.org/show_bug.cgi?id=311099), [WebKit issue 314934](https://bugs.webkit.org/show_bug.cgi?id=314934)

## 5. QR/device approval and TVs

RFC 8628 standardizes device authorization for input-constrained clients. A device receives separate device/user codes, shows a verification URI, and polls while the user approves on another device. QR presentation is an optimization, not authentication by itself. It includes expiry, polling controls and explicit remote-phishing concerns. It is not a replacement for ordinary browser OAuth on capable devices. [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)

Proposed Odysee exploration:

- Prefer FIDO hybrid for ordinary phone-to-browser passkey use; evaluate device authorization for TV/console access.
- If approving a new Odysee browser session, bind the request to the intended node origin, requested privileges, initiating session/device and one-use challenge.
- Show the intended device, destination and a matching code before approval. Treat all device labels as untrusted until bound by the protocol.
- Use expiry, approval denial, rate limits and replay rejection; never place the hosted key, cookie or refresh credential inside a QR code or public message.
- Prove that an attacker who sends their own login QR to a victim cannot obtain an unintended session. Code matching helps but is not an equivalent substitute for FIDO's proximity-bound transport.
- A public/shared TV should receive limited rights and short lifetime, not the ability to export the account wallet. Whether the current signer can enforce that distinction is an implementation prerequisite.

## 6. External wallets and SIWE

SIWE is ERC-4361: Ethereum account authentication with a structured signed message containing domain, URI, nonce, chain and timestamps. EOAs and smart-contract accounts have different verification requirements, and contract validity can depend on chain state. It creates sessions bound to the Ethereum address; it does not grant authority over an unrelated native account. [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361)

Two genuinely different options:

- **Linked external-wallet login:** current account authorizes linking an external address; proof of that address later unlocks a session for the same hosted wallet. This preserves native ownership but retains custody and recovery dependencies.
- **Direct portable signing:** users sign native committed messages in an external wallet. Requires compatible signature envelopes, canonicalization, algorithms and verifier behavior. Existing RSA-encrypted private playlists still need their original decryption key. Ethereum message signatures are not interchangeable with an Arweave JWK or HyperBEAM commitment.

Evaluate Arweave-compatible wallet providers separately from SIWE. A compatible signer may still decline private-key export or encryption/decryption operations required by the current UI. Never request a seed phrase, derive a wallet from a public address, or infer native ownership from an imported historical channel label.

Recommendation: optional advanced login, not the default mass-market recovery path. Link/unlink requires fresh proof of both sides and conflict handling; a lost external wallet must not silently orphan the native account.

## 7. DBSC is session hardening, not another login provider

Chrome documents Device Bound Session Credentials as available on Windows from Chrome 145. The browser protects a key using the TPM and proves possession when refreshing short-lived cookies. It reduces the reuse window for copied cookies. [Chrome announcement](https://developer.chrome.com/blog/dbsc-windows-announcement)

For this project, first determine whether the current `secret-*` carrier is compatible with an independently revocable short-lived session layer. DBSC requires registration/refresh handling and cannot protect an exported signing key. It neither recovers the account on another device nor specifies which wallet a session may use. The server must still expire/revoke sessions and decide a safe fallback for unsupported browsers. [DBSC integration guide](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

Do not make DBSC a universal launch dependency; the primary evidence here establishes Chrome/Windows availability, not all browsers/operating systems or a finished cross-browser standard.

## Documented support versus acceptance

| Capability | Evidence on research date | Required qualification |
| --- | --- | --- |
| WebAuthn Level 3 | W3C Recommendation, August 2026 | Standardization is not complete per-feature deployment |
| Chrome passkey/sync/hybrid | Google platform documentation | Test real OS/provider/policy combinations |
| ROR | Chrome and Safari documented; Google's page says Firefox still considering as of January 2026 | Firefox September status not independently established here; use detection and fallback |
| Safari PRF | Shipped announcement plus later hardware-path bug reports | Test exact browser/OS/authenticator and round-trip encryption |
| PRF across all Firefox/Chrome providers | No complete current first-party matrix established in this review | Unknown, not declared universally supported or unsupported |
| OAuth device grant | Published Standards Track RFC | Operator must actually implement issuer, polling and consent |
| SIWE | Final ERC specification | Each wallet/verifier and chain-account type needs tests |
| DBSC | Chrome 145/Windows vendor announcement | Optional, not universal baseline |

## No-code research acceptance plan

1. **Account continuity design review:** identify the authority mapping, session issuer, custodian and exact old encryption material for each option. Record allowed node classes and outage dependencies.
2. **Prototype proposal, not production mutation:** define an isolated HTTPS environment and disposable identity/ciphertext fixtures. Do not use the shared node or real creator wallets.
3. **Interoperability matrix:** Chrome/Edge Windows, Chrome/Safari macOS, Safari iOS, Chrome Android and Firefox desktop/Android; record exact versions and credential providers, not only browser names. Include hardware key, synced credential and hybrid paths.
4. **Continuity cases:** new device, original device offline, node A unavailable, factor added/removed, provider lost, all devices lost, account switching, concurrent registrations and login to wrong account.
5. **Authority assertions:** same native committer before/after login; successful read of old encrypted preferences and private playlists; unchanged immutable public history; foreign account cannot link or export.
6. **Attack cases:** challenge replay, wrong origin/RP, malicious community-node destination, QR relay, stolen session, stale revocation, parallel redemption, cross-account linking, XSS assumptions and compromised-node behavior.
7. **Lifecycle semantics:** distinguish browser logout, issuer session revocation, passkey removal, provider logout and native signing-key compromise. Specify maximum stale authorization window across nodes.
8. **Decision output:** compare hosted-passkey unlock, controlled-domain handoff and PRF-wrapped recovery against user friction, custody exposure, engineering scope and demonstrated platform support. Only then propose implementation.

The first deliverable should be this account/custody/lifecycle contract and a small disposable compatibility experiment—not a second Google auth implementation or a replacement product write device.
