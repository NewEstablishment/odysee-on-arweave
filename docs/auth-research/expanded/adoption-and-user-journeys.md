# User journeys, adoption and evaluation

Date: 2026-09-21. Product hypotheses and research plan, not measured Odysee conversion results. This complements the topic reports rather than ranking technologies solely by cryptography.

## What the evidence actually says

- FIDO's 2025 Passkey Index aggregates participating large providers, not a random sample of all products. It is useful evidence that passkeys can work at scale, but not a forecast of adoption for this audience. [Report introduction](https://fidoalliance.org/passkey-index-2025/)
- Internet Identity's own product page reports a 50% registration drop-off motivating familiar OpenID alternatives. The page does not provide enough cohort/methodology detail to attribute every abandonment to passkeys. It is a useful counterexample to assuming a technically strong login automatically makes onboarding easy. [Internet Identity](https://identity.internetcomputer.org/about)
- A 31-participant qualitative USENIX Security 2026 study found difficulty identifying/removing adversarial passkeys and understanding security interfaces across three popular services. This is evidence for testing recovery/security management, not a population-wide failure-rate estimate. [Daffalla et al.](https://www.usenix.org/conference/usenixsecurity26/presentation/daffalla)
- W3C's accessible-authentication guidance supports usable alternatives and assistance such as paste/autofill; an OTP flow that forces transcription is avoidable friction. Consider assistive technologies throughout recovery too. [WCAG 2.2 explanation](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)

These sources support measuring the entire account lifecycle. They do not establish that email, passkeys or wallet login will win an Odysee experiment.

## Personas and proposed experience

| User | What they want | Proposed experience to compare | Failure that matters |
| --- | --- | --- | --- |
| First-time viewer | Watch immediately, perhaps follow/comment | Keep public viewing unauthenticated; explain persistent-account choice when taking an owned action | Surprise signup/key backup blocks viewing |
| Existing legacy viewer | Return to familiar follows/history | Familiar email entry; explicit migrate/link step and preview of recoverable data | New empty account mistaken for successful migration |
| Existing native cookie user | Preserve already-created uploads/private lists | Offer linking a login method while current native authority is present | Clearing cookie before secure binding strands current work |
| Creator | Retain channel, moderation and content | Strong recovery setup and optional hardware/passkey step-up, with understandable session/device screen | Mailbox or support compromise silently transfers channel |
| Privacy-focused viewer | Avoid Google/email and cross-site tracking | Optional pseudonymous passkey/recovery-key or compatible-wallet route | Forced public identifier, KYC or biometric proof |
| Mobile/in-app-browser user | Finish with minimum app switching | Compare email code paste/autofill, same-device link, passkey and external-browser handoff | Link opens different browser/account and loses pending action |
| TV/shared-device user | Watch without typing secrets | Narrow, time-limited device approval; explicit signout | Full wallet export rights given to a shared television |
| User with old/shared hardware | A reliable alternative | Keyboard-accessible email or other supported route, clear persistence warning | Passkey/extension/hardware-key requirement excludes them |
| Community-node visitor | Understand who is trusted | Separate read-serving node from trusted login/custody destination | Untrusted node gets reusable global authority |

Do not present ten equal login buttons. The experiments should compare a familiar default with an optional privacy/advanced route and a clearly named recovery path. Which default wins is deliberately undecided.

## End-to-end scripts for candidate evaluation

### Familiar email onboarding, with a stronger factor offered later

1. User watches without signing in, then chooses Follow or Comment.
2. Explain that an account preserves their activity; collect email only if they select that method.
3. Send a link/code bound to the transaction and destination; preserve the user's intended action across application switching without storing credentials in URLs/analytics.
4. On redemption, resolve the private enrolled account binding. If currently owning native content, complete explicit linking rather than replacing the wallet.
5. Show the original page and allow the intended action once. Do not duplicate it on callback retries.
6. After value is experienced, offer passkey/independent recovery setup with an honest description of operator custody.
7. A later login on another device restores the same content and private state; a session screen can revoke the first device.

Hypothesis: familiar entry plus gradual stronger-factor enrollment reduces initial friction. Counter-risk: users postpone recovery and treat mailbox possession as sufficient protection. Measure both outcomes; do not silently overstate security.

### Pseudonymous passkey or wallet onboarding

1. Choose an email-free route; explain where the credential lives and what losing it means.
2. Enroll a passkey or approve a compatible wallet challenge. No payment/network fee should be implied for ordinary content login unless a chosen design actually incurs one.
3. Create or bind the native account; show a readable account label distinct from cryptographic identifiers.
4. Offer another authenticator/recovery route and a restore test, with a clear warning before irreversible content/private data accumulation.
5. Test new-device return, provider ecosystem change, deleted credential and loss of all devices.

Hypothesis: attractive for privacy/crypto-native users; extension installation, ecosystem choice and backup language may deter mainstream viewers. Do not extrapolate one cohort's result to another.

### Legacy creator migration

1. Sign in through a trusted legacy flow or independent legacy-channel proof.
2. Present which account/channels were verified and which proof established control.
3. Prove authority over the destination native account; require explicit link approval.
4. Import authorized data with provenance and idempotent checkpoints; keep identity migration distinct from social/content import.
5. Verify editable new ownership contracts without rewriting immutable old evidence.
6. Enroll independent future login/recovery so retiring the bridge does not strand the creator.

Source-specific details and unresolved verifier rules belong in `legacy-magic-links.md`. An email match alone never completes step 1 or 3.

## Acceptance and measurement

Before choosing a primary method, test every serious candidate against the same fixture account containing an upload, edited comment, follow, private playlist and encrypted preferences. Include wrong-account and interrupted-flow fixtures.

| Metric | Precise interpretation |
| --- | --- |
| Enrollment completion | Completed enrollment / users who deliberately began that method; distinguish provider/browser cohorts |
| Return-login completion | Successful same-account returns / attempted returns; not just callback 200s |
| Time to intended action | Time from Follow/Comment intent to completed action, including email/app switching |
| Account fragmentation | Duplicate or empty replacement accounts per intended returning user |
| Recovery completion | Same owner plus old private fixture recovered / recovery attempts |
| Security-management success | Users can identify/revoke a test device/factor without locking themselves out |
| Delivery/verification failures | Email latency/bounces, unavailable auth provider, unsupported browser, prover/chain/RPC failures separately |
| Operator dependence | Does a rehearsed provider/node outage preserve login or recovery? Include export before and after outage |
| Support burden | Tickets and assisted recovery actions per relevant attempt volume |
| Privacy/security regressions | Leaked challenge/identifier, unexpected tracking or unauthorized linkage; these are guardrails, not acceptable conversion tradeoffs |

Start with moderated usability sessions across the personas, then an opt-in staged rollout if implementation is approved. A small formative study is not statistically powered proof of conversion uplift. Define sample size and success thresholds from a measured baseline and product risk, not borrowed vendor percentages.

Use privacy-minimized event labels and aggregate timing. Do not record tokens, email addresses, wallet keys, raw proofs or full login URLs; document retention and consent. Do not reintroduce legacy analytics transport merely to measure this.

## Rollout and rollback principles

- Feature flag the new entry method; preserve existing account mappings and valid credentials during rollback.
- Do not roll back by deleting wallets or resetting users to an anonymous identity.
- Rehearse provider loss and restore before making a provider the sole enrollment or recovery path.
- Give creators a stronger opt-in path, and explicit warnings for weak recovery rather than opaque security jargon.
- Treat transaction completion, session management, factor management and content ownership as distinct observable outcomes.
- Publish capability/support limits: supported origins/devices, whether recovery needs email/provider access, and which operators can sign/decrypt.

## Meeting questions focused on adoption

1. Is email-free participation a launch requirement or an advanced option?
2. Which legacy cohorts must migrate without losing history, and which channels need stronger proof?
3. Should viewers and high-value creators have different recovery requirements?
4. Are we willing to require an extension, phone, provider account or recovery kit? For whom?
5. Can the product continue serving public content during authentication outages?
6. Which support powers are acceptable, and how do users understand them?
7. Which candidate deserves a user-tested prototype before architecture selection?
