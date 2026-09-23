# Unusual recovery, distributed custody, and long-tail authentication

Research date: 2026-09-21. Primary-source research and architectural proposals, not implemented integrations or security certifications. The security-review checklist was applied to secrets, challenge binding, authorization, revocation, abuse and recovery. No services, credentials or application code were changed.

## What is actually worth exploring

The strongest additions beyond ordinary Google/email/passkeys are **Juicebox-style threshold PIN recovery, Anastasis-style independent escrow, and Signal SVR3-style hardware-diverse recovery**. These solve a different problem from login: recovering a previously generated secret without depending on one browser. They are not interchangeable, and none eliminates the need to locate the right account or authorize a fresh session.

For this application, recovering the **exact existing hosted RSA wallet** is the least disruptive experiment. [The native audit](../native-auth-audit.md) explains that signatures, same-owner revision chains, private-playlist envelopes and preference encryption depend on that wallet. A new passkey, guardian key or EVM wallet is not automatically its successor. Preserve the serialized wallet too: current preference derivation has a serialization dependency that needs explicit testing.

Two designs must not be confused:

- **Secret recovery:** release a wrapping key that decrypts the existing wallet; current generic product writes remain unchanged.
- **Authority recovery:** authorize a new signer through a stable account/controller policy; this requires versioned ownership verification throughout native products, plus a separate old-data decryption plan.

An encrypted wallet backup is still sensitive security material. Do not place raw keys, PINs, shares, email addresses or provider tokens in public committed messages. Even an encrypted backup needs explicit placement, metadata-privacy and offline-attack review; this report does not approve publishing it permanently.

## 1. Juicebox: recover a secret using a PIN and independent realms

**Verified mechanism.** Juicebox combines threshold sharing, oblivious PRFs, encrypted secrets and bounded recovery guesses. Realms may be HSM-backed or software-backed. Independence matters: multiple realms under the same administrator are not independent trust boundaries. Threshold selection trades availability against compromise tolerance. The protocol describes destruction after excessive failed recovery attempts. [Protocol, revision 7](https://juicebox.xyz/assets/whitepapers/juiceboxprotocol_revision7_20230807.pdf)

The SDK has Rust, JavaScript, Swift and Android interfaces. Realm access additionally requires JWTs issued by the application's tenant authentication service, with subject identifying the secret and audience identifying the realm. **Knowing a PIN is not the whole login flow.** [SDK repository](https://github.com/juicebox-systems/juicebox-sdk)

An open software-realm implementation can be operated independently; its documentation supplies a GCP deployment path and tenant JWT-key configuration. This verifies a self-hostable component, not that enough independent commercial HSM operators are currently available to us. Operator contracts, prices, service-level commitments, audit scope and maintenance status remain procurement checks. [Software realm](https://github.com/juicebox-systems/juicebox-software-realm)

**Proposed Odysee lifecycle and integration:**

1. Signup still creates the current native wallet. User elects “Protect account with a recovery PIN.” Generate a random wrapping key; encrypt the exact wallet backup; register the wrapping key with selected realms. Verify recovery before calling enrollment complete.
2. Ordinary login remains email/passkey/Google, issuing a revocable node session. Do not run recovery for every comment.
3. New device: prove a linked identity to the tenant issuer, obtain realm-scoped authorization, enter PIN, recover wrapping key and decrypt backup in a trusted client. Import only through an audited, authenticated node boundary, checking expected owner before enabling writes.
4. Lost all devices: works only if the account locator, issuer authentication, sufficient realms, PIN and encrypted backup are all available. An independent recovery credential is needed if Google/email is also lost.
5. Provider outage: surviving realms help only up to the configured threshold; they do not bypass a sole unavailable JWT issuer. A replicated issuer or separately authorized recovery issuer needs its own protocol and key lifecycle.
6. Revocation: remove compromised sessions independently; replace recovery enrollment and backup wrapping as needed. A party that already recovered the full RSA key retains that authority—PIN change cannot erase it.

**Adoption and cost inference:** attractive familiar PIN UX; dangerous if “too many guesses” silently becomes permanent account loss. Requires clear remaining-attempt messaging, denial-of-service analysis, support policy, realm monitoring and independent backup. Cost is operator/HSM hosting plus issuer and support, not just a JavaScript SDK. No verified current quote obtained.

**Experiment:** synthetic wallet, two independently administered software realms plus a third candidate realm, explicit registration/recovery thresholds; recovery on clean browser; one realm unavailable; issuer unavailable; stale configuration; PIN retry exhaustion; PIN change with an old backup; restored owner and private-data reads. First establish SDK payload limits; wrapping a short random key avoids assuming it stores arbitrary RSA keyfiles.

**Kill criteria:** no genuinely independent threshold; issuer cannot be recovered independently; malicious authorization can cheaply exhaust victim guesses; no supported operational rollback protection; restored wallet or old ciphertext fails verification. Never replace this with an offline PIN-encrypted file.

## 2. GNU Anastasis: configurable independent recovery escrow

**Verified mechanism.** Anastasis is a protocol and implementation for small core secrets, not bulk data. An encrypted core secret is protected through provider-distributed key material and configurable recovery policies. Its documentation identifies itself as `0.0.0pre0`; that label is not proof of current abandonment or production readiness. [Project documentation](https://docs.anastasis.lu/)

Recovery documents describe providers, challenges and allowed combinations. Identity attributes locate records; they are explicitly not assumed to be cryptographically strong secrets. Providers learn challenge-related “truth,” such as contact information. Policies can permit combinations such as A+B or A+C, with collusion assumptions stated explicitly. [Protocol introduction](https://docs.anastasis.lu/introduction.html)

**Proposed Odysee fit:** protect an independent wallet-wrapping key under a provider policy rather than inventing our own escrow protocol. Keep normal account sessions and all signed product writes unchanged. A recovery UI gathers the enrolled attributes, retrieves the policy, guides the user through sufficient provider challenges, then restores the exact wallet via a secure import boundary.

**Lifecycle:** enrollment requires deliberate policy choice and proof that challenges work; normal login need not involve escrow. Lost devices can be tolerated if a policy still succeeds. Lost email requires a policy not exclusively dependent on that email. Provider outage is tolerated only if another allowed combination survives. Revocation requires new policy/enrollment and understanding which old provider records remain usable; it cannot retract previously recovered wallet keys.

**Adoption inference:** unusually appropriate for users who cannot safeguard a seed phrase, but identity questions, video/postal verification or multiple recovery providers are substantial friction and privacy commitments. Do not require passport-style identifiers for ordinary video viewers simply because the reference design lists them. Availability of independent acceptable providers, fees, retention/deletion obligations, localization and actual mobile UX are unverified. Odysee operating all providers would remove much of the decentralization benefit.

**Experiment:** two alternative policies using genuinely different failure domains; erase the client; lose the preferred email; recover through the other policy; simulate one provider disappearing and migrate policy while access remains. Evaluate legitimate completion time and what personal information each provider observes.

**Kill criteria:** policy requires unavailable commercial providers; all methods reduce to one mailbox/operator; unacceptable personal-data collection; unreadable recovery document after loss of the supposedly memorable locator; no reliable provider-exit procedure.

## 3. Signal SVR2/SVR3: deployed design evidence for PIN recovery

**Verified mechanism.** The Signal repository describes SVR2 using persistent guess counts and replicated in-memory Raft state. SVR3 distributes secret recovery across SGX, Nitro and SEV-SNP protected backends. The project's stated priority favors losing a secret over leaking it when those goals conflict. This is a security/availability tradeoff, not ordinary database replication. [Signal source](https://github.com/signalapp/SecureValueRecovery2)

The OSDI 2024 authors report partial rollout to millions of users, hardware-diverse trust, rollback protection and fault tolerance. Their measured cost/latency are deployment results, **not estimates for Odysee or a purchasable service price**. [SVR3 research paper](https://eprint.iacr.org/2024/887)

Signal's user documentation carefully separates recovering profile/settings/contacts/block list from recovering chat history; a PIN cannot restore lost chat history, and Signal cannot reset the PIN. That separation is a useful UX precedent: “account recovered” must not falsely promise that every Odysee private asset was restored. [Signal PIN support](https://support.signal.org/hc/en-us/articles/360007059792-Signal-PIN)

**Proposed Odysee fit:** study the architecture and test vectors before considering a fork. A private recovery service could release a wallet-wrapping secret to a verified client, while HyperBEAM remains the signer/store boundary. Do not transplant Signal identity or phone-number registration into Odysee. Its repositories are not a hosted login SaaS; integrating issuer/account binding, attestation verification, compatible client transports and recovery records remains our work.

**Lifecycle/operations inference:** familiar PIN on a new device is promising; enrolled PIN plus separately satisfied account-access requirements recover the wrapping secret. All-required shares increase outage sensitivity compared with an availability-oriented threshold. Enclave diversity reduces a single hardware-vendor failure domain, not phishing/XSS or malicious frontend delivery. Revocation, enrollment reset and an unavailable identity provider remain separate problems. Operating several clouds, measured builds, consensus groups, attestation updates and irreversible-guess policies is a large release workstream.

**Experiment:** architectural spike only first—trace account-auth gate, rollback behavior, cluster replacement and backup semantics in the code/paper; test synthetic-key recovery through supported clients; state-loss drill; outdated enclave rejection; one hardware backend unavailable. Require an independently usable break-glass backup.

**Kill criteria:** team cannot maintain the attestation/consensus operational burden; a browser build cannot safely verify the required channel; any desired restore process resets guess counters; marketing demands “cannot lose account” despite irreversible-secret-loss behavior.

## 4. OPAQUE, threshold OPRFs and SPHINX

OPAQUE is a password-authenticated key exchange with hidden passwords and resistance to precomputation after server compromise. RFC 9807 is a CFRG/IRTF informational RFC, not an Internet Standards Track specification. It supports credential recovery/export-key applications, but server compromise can still enable per-user offline dictionary attacks; it does not make a weak password high entropy or supply account recovery policy. [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)

SPHINX's documented client combines an OPRF-based password manager with optional OPAQUE-Store. Its client requires backing up a master key, supports threshold configurations, and warns that common control of sufficient SPHINX and storage servers undermines the separation. Thus “remember password only, lose every artifact” is not an automatic property of that implementation. [Maintainer manual](https://github.com/stef/pwdsphinx/blob/master/man/sphinx.md)

**Proposed fit:** independent OPRF providers can harden a password-based wallet backup; OPAQUE can authenticate a private account session without sending a password to its server. Either requires audited implementations, record discovery, abuse controls, browser resource budgets and a stable binding to the existing wallet. Password reset without the old password cannot magically decrypt a backup unless a second recovery mechanism exists.

**UX/availability:** passwords are familiar, but reintroduce forgotten-password support and phishing. Independent servers help against one compromised operator, while increasing deployment/availability complexity. Lost all devices succeeds only if all implementation-specific client metadata needed for addressing/authentication is itself recoverable. Existing SPHINX desktop/CLI flows are not evidence of an Odysee-ready mobile browser UX.

**Experiment:** evaluate established library support rather than implement cryptography; recover a synthetic wrapping key from a fresh browser; deliberately omit backed-up client metadata; test compromised-server assumptions and slow low-memory phones. Reject if recovery secretly depends on lost local state, if every service shares an administrator, or if “forgot password” silently creates a replacement owner.

## 5. Guardians and Safe smart-account recovery

Safe's documented recovery changes contract-account signers after a delay; recovery must be configured before loss. Recoverers can propose changes bypassing ordinary signer thresholds, and existing authorized signers can cancel. Its guide says the initial release did not automatically notify signers, and describes two gas-requiring on-chain transactions. The article explicitly dates some behavior to December 2023: **confirm current notifications/UI rather than claiming they remain absent today**. [Safe recovery guide](https://help.safe.global/articles/9622260218-account-recovery-with-saferecoveryhub)

Standards distinguish different capabilities:

| Standard | What it provides | What it does not provide for Odysee |
| --- | --- | --- |
| [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) | Contract-defined signature validity | An RSA commitment or old playlist decryption |
| [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) | UserOperation/account-abstraction execution infrastructure | A universal guardian or recovery policy |
| [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) | Minimal modular-account interfaces | Proof every installed module is safe |
| [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) | Delegating EOA execution behavior to code | Automatic elimination/recovery of the EOA root key |

**Two possible integrations, both proposals:** (A) guardians authorize a custodial recovery boundary to release the exact RSA wallet—preserves current signer but adds trust in release custody; (B) stable account authority accepts guardian-authorized new signers—requires an explicit native authority migration. Simply accepting an EVM address in the profile is neither.

**User lifecycle:** enroll trusted people/devices before loss; ordinary sessions stay simple; lost-all recovery gathers the configured approvals and waits through the delay; provider outage depends on chain/RPC and guardian availability. Revoking guardians must update authoritative policy; a copied key or old recovery artifact may still need separate handling. Guard against coercion, collusion, deceased/unavailable guardians, relationships ending and malicious recovery while the owner is offline.

**Adoption/cost inference:** suitable optional protection for creators, organizations and high-value accounts; excessive friction for mandatory viewer signup. Smart-account routes add wallet/RPC/network/gas or sponsor dependencies. Off-chain guardian shares avoid chain fees but need authenticated share delivery, backup-format interoperability and a recovery ceremony. Secret sharing is not threshold signing: reconstruction reveals the recovered secret to the reconstruction endpoint.

**Experiment:** choose one clearly scoped design; two-of-three guardian recovery with one missing guardian, malicious request cancellation, chain/RPC outage, stale policy rejection and notifications through an independent route. Verify actual old content edits/decryption, not merely successful EVM signature checks. Reject if guardians only rotate an unrelated signer or there is no reliable detection/cancellation experience.

## 6. Passkey PRF / hardware `hmac-secret` as backup unlock

The WebAuthn PRF extension exposes credential-associated pseudorandom output and has explicit support negotiation; ordinary WebAuthn authentication success does not imply PRF output availability. The CTAP mapping uses `hmac-secret`. [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/#prf-extension), [Yubico technical explanation](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/CTAP2_HMAC_Secret_Deep_Dive.html)

**Proposed fit:** wrap one random backup key separately for each enrolled PRF credential, rather than derive a new signing wallet from passkey material. Browser obtains PRF output after user interaction, decrypts exact wallet backup in memory, and uses an audited import/session boundary. Hardware security keys can be a deliberately independent spare.

**Lifecycle:** enroll at least two recovery paths while the original wallet is accessible; everyday login can remain normal WebAuthn. New-device recovery requires the credential and its usable PRF secret, not merely a similarly named newly created passkey. Lost all devices relies on successful credential-provider recovery or an independent spare/recovery kit. Cloud-provider outage may still allow a locally available credential, but do not promise that on every platform. Revoking a server credential does not erase already captured PRF-derived decryption material or immutable backups.

**Adoption/cost:** potentially excellent biometric UX without a seed phrase; hardware purchases and provider-sync behavior complicate support. Matrix test actual Chrome/Safari/Firefox, Android/iOS/desktop, roaming vs synced authenticators, cross-device transport, backup restore and RP origin changes. Reject as sole recovery method if any supported platform cannot restore the same PRF output, or if losing the RP domain makes backup recovery impossible. Treat changing the current browser-key policy as an explicit architecture decision.

## 7. Matrix as a useful design comparison, not an auth replacement

Matrix separates device access, cross-signing and secret storage. Its secret-storage format supports multiple encrypted copies keyed by key identifiers; a recovery key or passphrase unlocks private data independently of ordinary account access. [Matrix specification](https://spec.matrix.org/latest/client-server-api/#secret-storage)

**Inference for Odysee:** copy the product distinction—“signed in” versus “private history unlocked”—and verified-device approval UX, not a second Matrix account/data backend. Prototype loss of all devices and recovery keys: users should be told precisely what remains recoverable. An account reset must not masquerade as restoration of encrypted history. No Matrix integration was evaluated or proposed as a launch dependency.

## 8. Screened long tail: deliberately shallower than the studies above

These were checked against primary protocol material. No client interoperability, current adoption, maintenance cadence or production audit was established. They are not silently excluded, but none is a recommended default signup method.

| Candidate | Mechanism and credible niche | Odysee fit / reason to screen out as default |
| --- | --- | --- |
| [SQRL](https://www.grc.com/sqrl/key-flow.htm), [identity lock](https://www.grc.com/sqrl/idlock.htm) | Site-specific identities and separate rescue/unlock material | Could authenticate a private wallet binding; adds client installation/recovery-code literacy, domain mapping and a new protocol. No evidence here of support sufficient for our target browsers. Useful design reference for separating everyday and recovery authority. |
| [WebID-TLS](https://www.w3.org/2005/Incubator/webid/spec/tls/) / client certificates | Prove possession of a TLS client key, associate it with a WebID profile | TLS termination and certificate provisioning become auth boundaries; browser certificate-selection and mobile lifecycle require testing. Operator/enterprise niche, not magic user recovery. The cited specification is community work, not evidence of mainstream browser product support. |
| [OpenPGP](https://www.rfc-editor.org/rfc/rfc9580.html) signed challenges | Users with existing keys sign audience-bound, single-use challenges | Optional technical-user/creator credential; key verification, revocation and signing UI needed. PGP user ID/email strings are not independent proof of mailbox or legacy-channel ownership. |
| [S/MIME](https://www.rfc-editor.org/rfc/rfc8551.html) signed email | Certificate-backed signed challenge returned through email | More end-user-key assurance than DKIM-domain signing where correctly validated; CA trust, certificate lifecycle and mail-client compatibility add onboarding friction. Never accept a generic old signed email as fresh login approval. |
| [OpenSSH message signatures](https://man.openbsd.org/ssh-keygen) | Namespace-bound challenge signatures for existing SSH-key holders | Reasonable optional operator/developer login; manual challenge or companion client, allowlisted keys and revocation required. Keep namespace/purpose separate from infrastructure access; do not ask users to expose SSH private keys to the browser. |
| [DNS domain-control challenges](https://www.rfc-editor.org/rfc/rfc8555.html) | Domain owner publishes a fresh challenge | Creator/organization verification or recovery factor, not human identity. Registrar compromise, expiration and ownership transfer must not silently transfer a legacy channel. Bind freshness, intended account and current owner authorization. |
| [Identity-based encryption/email](https://www.rfc-editor.org/rfc/rfc5408.html) | Identifier such as email is used with a private-key generator | Email address becomes convenient addressing, not secret entropy; key generator is a privileged trust boundary. Does not remove mailbox verification or issuer availability. Poor default absent a compelling escrow policy. |

For every optional challenge-signature method: onboard by proving both current native account control and new credential possession; issue normal short-lived sessions after fresh domain/audience/purpose/nonce-bound approval; lost-all recovery needs another enrolled method; remove credentials with strong reauthentication; changing an external credential must preserve the native wallet binding. No old signature or public profile field authorizes a fresh login.

## Meeting-ready selection and concrete next work

| Exploration | Why spend time | First decision / measurable gate |
| --- | --- | --- |
| Juicebox wrapper spike | Familiar PIN, multiple trust boundaries, browser SDK | Can we obtain independent realms and survive loss of the identity issuer? |
| Anastasis provider/policy feasibility | Recovery beyond “remember a secret” | Can ordinary users recover with acceptable privacy and independent providers? |
| SVR3 architectural review | Real deployed evidence for short-PIN security | Can we operate attestation, consensus and rollback protection safely? |
| PRF-encrypted same-wallet backup | Potentially simple device UX | Same bytes decrypt across actual supported device/provider recovery combinations |
| Guardian recovery design | Valuable creator safety feature | Choose same-wallet escrow vs versioned signer succession before coding |
| OPAQUE/threshold-password spike | Avoid sending passwords; explore provider independence | Audited browser-compatible implementation and no hidden lost-device dependency |

All experiments must use disposable synthetic accounts. Shared-node wallet export/sync is **not authorized by this research**. Reuse generic writes for product activity; implement only a narrow separately reviewed auth/recovery boundary if a design is later approved. Run native revision/decryption regression acceptance after recovery, plus stale-session, provider-outage, enrollment-race and adversarial-recovery cases. Never label a restored display name as a recovered account.

These are coverage of materially different mechanisms, not a claim that every possible research protocol has been exhausted. Remaining diligence includes exact SDK versions/licenses/audit scope, operator availability and pricing, browser support, user studies and deployment-specific attack review. No precise adoption or cost claims should be made before those checks.
