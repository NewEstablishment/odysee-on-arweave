# Email authentication alternatives

Research date: 2026-09-21. Status: proposal and source review, not implementation or security certification. Scope: outbound email codes/links, incoming signed email, attestation, and ZK-email variants. No services, production accounts, secrets, or application code were changed. The security-review skill informed threat analysis and the acceptance checklist.

## Recommendation

Explore **outbound email codes as an optional convenience login/recovery channel**, alongside Ayush's OIDC work, after agreeing how an authenticated identity unlocks the existing hosted wallet. Keep **incoming DKIM email as a separately gated experiment**. Investigate **ZK Email only if private, independently verifiable email attestations become a concrete requirement**; it is not a shortcut to portable accounts.

Email alone should not be the strongest recovery path for a valuable creator account. NIST SP 800-63B-4 excludes email from its out-of-band authentication category because of mailbox access, interception, and rerouting risks; address confirmation and specified recovery codes are treated separately. This is an assurance benchmark, not a claim that a consumer site is forbidden from offering email login. Do not label email login phishing-resistant or NIST AAL2 merely because a mailbox provider offers MFA. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)

## Keep three decisions separate

1. **Authentication evidence:** what demonstrates control of an enrolled email or another factor now?
2. **Account binding:** which stable native account is associated with that evidence, and who can change the association?
3. **Key access:** how does the successful login recover the same signing wallet and decrypt old private data?

These are architecture requirements inferred from the current store-first constraints. A valid email challenge does not itself supply an Arweave signing key. Creating a new wallet after every login would strand same-committer ownership chains and potentially private playlists. The email identifier, a public challenge, or a DKIM signature must never be treated as secret wallet-generation material.

Native content remains generic signed `/id` messages with verified committer authority. Email processing belongs in a narrow private authentication boundary, not comment/profile/upload devices, browser calls to legacy APIs, or a required SSR product path. Raw emails, mailbox addresses, login tokens, wallet keys and session credentials must not be published to immutable public storage. A hash of a guessable email address is not anonymization.

## Options and tradeoffs

| Option | Useful property | Principal trust/cost | Suggested disposition |
| --- | --- | --- | --- |
| Outbound one-time code | Works across email app/browser and TV input; no clickable credential URL | Mailbox and delivery operator can observe/redeem credential; online guessing/phishing | First email prototype candidate |
| Outbound magic link | Familiar one-click experience | Bearer-link leakage, prefetch/scanner handling, different-browser behavior | Compare against code, not a separate identity model |
| Inbound challenge email with DKIM | User sends from their mail client; potentially verifiable signed evidence | Provider/domain-signing semantics, parser and DNS security, receiving infrastructure | Bounded research prototype |
| Private mail-verifier attestation | Nodes consume one uniform short-lived assertion | Explicit trusted issuer can impersonate; issuer availability and revocation | Possible deployment shape for either direction |
| ZK proof of an email property | Reduces content disclosure to verifier | Circuit, key registry/oracle, prover privacy, verification operations | Defer unless privacy requirement justifies it |
| Email guardians | Recovery authorization can require multiple people | Collusion, social engineering, shared-domain compromise, delay/support UX | Later high-value recovery research |
| S/MIME/OpenPGP-signed challenge | Proof of a user-controlled key, when correctly enrolled | Certificate/key enrollment and recovery burden; limited mainstream UX | Niche advanced-user option, not default |

The table is an Odysee-specific assessment, not a benchmark or a claim of existing support.

## 1. Outbound code or magic link

### Proposed flow

Start from a private authentication transaction bound to the initiating browser, intended account/action, permitted callback origin, and expiry. Send a cryptographically random code/token to the previously enrolled address. Redeem it exactly once, atomically; mint a fresh session only after verification. Store protected token verifiers and minimal transaction state, not plaintext bearer credentials in logs. Rate-limit issuance and verification per account and risk signals; return non-enumerating responses. OWASP's recovery guidance supports random, expiring, single-use tokens, consistent responses, trusted HTTPS callback construction and leakage protection. [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

For a code prototype, choose length, TTL and attempt budget together and document the online-guessing bound. An initial experiment could compare an eight-digit code with a five-minute TTL against a high-entropy link; these are proposed test settings, not an assurance certification. Resend behavior must be explicit: invalidate previous challenges or isolate transactions without leaving unlimited simultaneously valid guesses. Do not let an attacker lock an account simply by requesting codes.

Magic links require an explicit confirmation/exchange step. Automated link fetching must not log the scanner in, consume the user's only usable credential, or approve an unintended device. Disable mail click-tracking for authentication URLs. Supabase documents both email-link prefetching and rewritten tracking URLs as practical failure modes; this is evidence for testing them, not a recommendation to add Supabase. [Supabase email-template limitations](https://supabase.com/docs/guides/auth/auth-email-templates)

### Browser/device binding decision

Same-browser redemption is simpler to bind but breaks when mail opens a different browser. Cross-browser redemption needs a deliberate transfer/approval design, not silent removal of binding. For TV, show a device transaction and clear service/device context; the authenticated approval must authorize that transaction specifically. An attacker who induces a victim to enter a legitimate code into a phishing site can still relay it; transaction binding mitigates mix-ups, not all phishing.

### Address lifecycle

Use a stable internal account identifier; email is an enrolled contact/authentication method, not the native content identity. Normalize domains safely but do not universally strip plus tags, remove dots, or lowercase local parts to merge accounts. Avoid automatically joining Google and email identities just because displayed email strings match. Require proof for linking, recent authentication for changes, and notifications to old and new addresses. Provider-specific alias behavior, organizational reassignment, recycled mailboxes and shared inboxes need explicit policy. [OWASP Email Validation and Verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html)

### Operations to investigate

Choose operated SMTP versus a transactional provider; evaluate delivery latency, bounces, suppression, sender reputation, outage failover, abuse cost, retention and provider access to login messages. Test actual providers rather than declaring universal support. Independently hosted nodes should not each invent an email-to-wallet mapping that splits a user's identity.

## 2. Incoming DKIM-authenticated email

### What DKIM actually establishes

DKIM authenticates a signing domain's responsibility for covered message bytes; it explicitly separates signer identity from the purported author. The `d=` domain need not equal the visible From address. Its optional body-length restriction and selected signed headers matter; unsigned additions must not become authorization input. Signatures can survive forwarding and can be replayed. Consequently, a DKIM-valid email is not automatically evidence that a particular person approved this login. [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376.html)

DMARC alignment ties authenticated domains to the From domain; it does not prove exclusive control of an individual mailbox or authorize an Odysee action. [RFC 7489](https://www.rfc-editor.org/rfc/rfc7489.html)

Do not trust an arbitrary `Authentication-Results` header supplied with the message. Such results are meaningful only inside the defined trusted verifier boundary. Prefer verification of raw evidence or an authenticated assertion from an explicitly trusted receiving service. [RFC 8601](https://www.rfc-editor.org/rfc/rfc8601.html)

### Proposed strict experiment, not a finished protocol

1. Browser creates a short-lived private transaction. The application shows a prepared email addressed to an operated receiving endpoint. Sending mail is explicit user action.
2. Challenge payload includes unpredictable transaction ID, login/link/recovery purpose, audience, target node/origin and expiry. It must be bound to the intended browser transaction; a returned email must not authorize an arbitrary session chosen later by a relay.
3. Receiver validates a constrained accepted format and signature algorithm/key strength, parses one unambiguous author identity, verifies complete coverage of every authorization field and enforces an explicit sender-domain policy.
4. Reject ambiguous duplicate headers, malformed MIME, unsigned security fields, partially signed authorization bodies, mismatched From domains, expired challenges and replay. Do not silently accept unsigned mail or downgrade to SPF-only success.
5. Bind the verified evidence to the enrolled account and consume the transaction once across all participating nodes. The browser receives only transaction completion, not raw email or reusable proof credentials.

These strict rules are proposed application policy. They require a security-reviewed parser and hostile-fixture suite rather than a few regular expressions. RFC 8301 prohibits SHA-1 for DKIM and updates key requirements; selecting an established verifier still requires checking its algorithm support and fail-closed behavior. [RFC 8301](https://www.rfc-editor.org/rfc/rfc8301.html)

### Risks that remain even with a correct implementation

- **Provider policy:** a domain may sign messages sent by delegated users, relays or shared accounts. We need evidence of what mailbox authorization each supported provider actually enforces; a domain allowlist is a trust policy, not proof of an individual human.
- **DNS/key lifecycle:** choose how keys are fetched, cached, revoked and rotated. A historical key archive does not independently establish when a message was authorized. Do not accept ancient proofs because an archived key once existed. Transient lookup failure must not become an auth bypass.
- **Message transformations:** forwarding, quoted replies, MIME encodings, HTML/plain alternatives, corporate disclaimers and mobile clients can alter accepted fields. Preserve bytes for private verification, constrain accepted messages, and measure compatibility.
- **Operator access:** receiving infrastructure sees sensitive correspondence. Define minimal retention and deletion, authenticated inbound delivery, attachment/size limits and parser resource budgets.
- **Consent:** sending a challenge after a phishing instruction is still possible. The email must clearly describe service, action and destination; inbound email is not automatically phishing-resistant.

This variant can reduce dependence on a particular outbound sender but replaces it with receiving, parsing, DNS and provider-policy obligations. It does not eliminate infrastructure or solve wallet availability.

## 3. Private attestations and ZK Email

An operated mail verifier could issue a short-lived, audience-bound assertion after challenge verification. This is a proposed federation boundary: receiving nodes trust that issuer to authenticate the enrolled identity. Specify issuer keys, expiry, nonce, audience, single-use redemption, session binding and revocation. A public long-lived email-to-wallet attestation would create identity correlation and stale authorization risks; avoid it. A hostile trusted issuer can impersonate users unless another factor or wallet proof is required.

ZK Email proves selected properties of DKIM-signed email without disclosing its complete contents. Its own security documentation retains trust in email-provider signing, DNS/key management and cryptographic implementations; it discusses registry/oracle key rotation, replay and front-running. That is not equivalent to removing all trusted parties. [ZK Email security considerations](https://docs.zk.email/architecture/security-considerations)

The project exposes proof blueprints and account-recovery components, including guardian approval and timelocks. Those are useful references, but existing smart-account recovery modules are not drop-in replacements for this repo's hosted wallet and exact-committer ownership. [ZK Email registry](https://docs.zk.email/zk-email-sdk/registry), [ZK Email recovery implementation](https://github.com/zkemail/email-recovery)

Before a prototype, specify exactly which statement is proven: enrolled mailbox commitment, signed challenge, service audience, transaction, expiry and authorized action. Ensure a copied proof cannot authorize a different node/session. Determine whether proving runs locally or on an external service; zero-knowledge toward the verifier does not hide the raw email from a remote prover receiving it. Measure browser memory/time, Erlang verification integration, circuit upgrades, audit coverage, key-oracle trust and proof size. These are research tasks, not demonstrated capabilities.

A guardian scheme additionally needs independent guardians, explicit enrollment, thresholds, timelocks, cancellation and notification. Three addresses at one compromised provider are not three independent trust domains. Recovery that merely installs a new signer still requires a native ownership-transition and encryption-key strategy.

## Prototype acceptance matrix

No live prototype was run in this research pass. Required checks before recommending implementation:

| Area | Required result |
| --- | --- |
| Existing anonymous/cookie account linking | Successful link preserves wallet address, profile root, public ownership and old private playlist/preferences decryption |
| New device / second operated node | Login returns same account; no duplicate wallet on concurrent first login; node A can be unavailable |
| Session lifecycle | Fresh session after auth, stolen-session revocation, logout, expiry, account-switch isolation and recovery tested separately |
| Replay/concurrency | One redemption wins across nodes; duplicate mail, retries and simultaneous submit never create extra authority |
| Login/link/recovery confusion | Challenge for one purpose cannot satisfy another; attacker-created transaction cannot silently bind victim account |
| Magic-link UX | Mail scanner, prefetch, tracking rewrites, alternate browser, stale tabs and wrong origin tested |
| Code abuse | Attempt/issuance budgets, resend semantics, distributed abuse, enumeration and mailbox-flood controls tested |
| Inbound signatures | Wrong domain, forged results header, unsigned challenge, duplicate headers, malformed MIME, partial body, stale key and weak algorithm rejected |
| Privacy | No raw emails/tokens/addresses/private keys in public messages, URLs after exchange, analytics, logs or exported fixtures |
| Provider compatibility | Gmail, Microsoft consumer/work, Apple, Proton, custom-domain and delegated/forwarding behavior measured with consented test accounts |
| Failure recovery | SMTP/DNS/verifier outage, delayed delivery and node crash fail safely without duplicate identity or lost old-key access |
| Custody | State exactly which operators can impersonate/sign/decrypt and whether recovery changes those powers |

## Questions for Ayush, Michael and Sam

1. Is email intended for primary login, initial account linking, recovery, or only an experiment? Do not accidentally give a weak fallback stronger authority than the primary method.
2. Which account/wallet mapping is authoritative across operated nodes, and how is a first-login race resolved?
3. Does recovery restore the same secret or authorize a new signer? How do private data and historical ownership survive?
4. Are community nodes trusted to hold user keys, only accept signed content, or redirect to an operated authentication authority?
5. Can we use an operated email relay initially, and who owns abuse controls, retention, incident response and delivery health?
6. What proof is required to enroll/change an address on an existing creator account? What happens after mailbox reassignment or compromise?
7. Is incoming email expected to work across all providers? If so, who owns compatibility measurement and the allowed-domain policy?

## Proposed next work

First agree the account binding/custody and recovery contract. Then run a non-production outbound-code versus link UX/security experiment with synthetic accounts, preserving the existing wallet. In parallel, give Michael a bounded inbound-DKIM fixture exercise with the rejection cases above. Defer ZK integration until its privacy objective and verifier/prover trust model are explicit. None of these tracks requires a new product CRUD device or a second Google implementation.
