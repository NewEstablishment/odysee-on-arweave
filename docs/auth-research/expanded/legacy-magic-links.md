# Legacy magic links: what exists, what can migrate, and what users experience

Research date: 2026-09-21. Read-only source inspection and primary web research; no live authentication, mail delivery, infrastructure change, or security exploit test. Security-review skill used as a checklist, not as a replacement architecture. Proposed flows below are not implemented.

## Meeting answer

**Yes, we can keep the familiar email-login experience without bringing back the legacy product API.** There are three materially different projects: temporarily trusting the old account service as an authentication issuer; replacing the email challenge service natively; and migrating legacy account/channel ownership. They should not be conflated.

The old flow is more interesting than “click a link and get a cookie”: the email approves an initiating anonymous installation/session, and the original tab polls until its account becomes verified. That explains why opening the mail on another device can be useful. It also creates a phishing/unsolicited-login-approval threat that the replacement must explicitly address.

Email is not decentralized identity merely because the account writes to Arweave. Mailbox provider, delivery provider, challenge issuer, binding registry, and wallet custody remain separate trust dependencies. Self-hosting removes a SaaS dependency, not those trust roles.

## Evidence inventory and version boundaries

Inspected sibling commits:

| Checkout | Commit | Relevant responsibility |
| --- | --- | --- |
| `/Users/bhavya_gor/work/odysee/odysee-frontend` | `658d1f714` | Login UI, verification landing page, polling, logout |
| `/Users/bhavya_gor/work/odysee/internal-apis` | `b21188f7` | Email records, verification tokens, account merge, token invalidation |
| `/Users/bhavya_gor/work/odysee-api` | `6cb1fd3` | Legacy user authentication and hosted LBRY SDK wallet routing |

These are local checkout facts, not proof of the exact deployed production versions. No environment/key files or real account data were needed. Current native constraints are documented in [native auth audit](../native-auth-audit.md), [private playlists](../../../decisions/private-playlists.md), and [cookie identity persistence](../../../decisions/cookie-identity-persistence.md).

## End-to-end legacy behavior

1. **Initiation:** [frontend user actions:537](/Users/bhavya_gor/work/odysee/odysee-frontend/ui/redux/actions/user.ts:537) call `user/signin`, optionally with a password. [signin.go:126](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/signin.go:126) deliberately returns conflict for the no-password path after email lookup. Frontend handles 409 by calling `user_email/resend_token`; it also handles a 417 response as an extra-verification branch. The inspected sign-in handler itself does not establish that 417 is currently emitted.
2. **New accounts:** [signup.go:24](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/signup.go:24) requires an existing request auth identity, creates an unconfirmed email record, optionally stores a password, then sends verification. Duplicate email returns 409. Optional passwords and password reset coexist with magic links; legacy was not exclusively passwordless.
3. **Challenge:** [token.go:78](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/email/token.go:78) uses `crypto.RandString(32)` and a 30-minute verification expiry. A different initiating user or expired token produces a replacement. Same unexpired claimant can reuse the current verification value on resend. RNG implementation was not separately audited, so length alone is not an entropy claim.
4. **Two credentials:** link generation [token.go:268](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/email/token.go:268) includes email, verification token, confirm-scoped auth token, and captcha hint in the URL. The confirm scope lasts 300 hours in [permission.go:46](/Users/bhavya_gor/work/odysee/internal-apis/app/auth/permission.go:46); this does **not** make the complete login link valid that long because verification expiry is separately enforced. Password reset has a different scope.
5. **Delivery:** [token.go:142](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/email/token.go:142) compiles HTML/plaintext templates and queues an operational email with click tracking disabled. Templates distinguish new email, welcome back, new location and password reset. Link origin is selected from a configured domain map using installation metadata, rather than any arbitrary supplied redirect. Active transport/provider configuration was not inspected, so no claim is made about current SES/Mailgun usage.
6. **Landing:** [signInVerify/view.tsx:18](/Users/bhavya_gor/work/odysee/odysee-frontend/ui/page/signInVerify/view.tsx:18) reads URL credentials and calls `user_email/confirm`; existing verified users auto-submit, while new users may need captcha. Success says the tab can close. The URL-supplied auth token is used for confirmation; this is not evidence that the browser receiving the email inherits the original full session.
7. **Verification and merge:** [confirm.go:37](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/email/confirm.go:37) checks scoped auth, challenge match/expiry and captcha where applicable. It expires the email token, marks email verified, and transactionally reconciles the initiating user with the existing email owner. [merge.go:26](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/merge/merge.go:26) rejects a merge when both users have wallets; this is already an explicit legacy account-collision case.
8. **Original-tab completion:** [userEmailVerify/view.tsx:40](/Users/bhavya_gor/work/odysee/odysee-frontend/ui/component/userEmailVerify/view.tsx:40) polls every five seconds; [user.ts:300](/Users/bhavya_gor/work/odysee/odysee-frontend/ui/redux/actions/user.ts:300) fetches the current user and observes verified email. UI resend delay is 30 seconds. This is not a server rate-limit guarantee. `ResendToken` parses `OnlyIfExpired` but passes `false` to the sending helper in this checkout.
9. **Wallet:** [odysee-api wallet.go:52](/Users/bhavya_gor/work/odysee-api/app/wallet/wallet.go:52) authenticates through internal-api, requires verified email, resolves/creates a local user keyed by legacy user ID, and assigns the hosted SDK wallet server. It does not derive the wallet from the email or the temporary token. A hosted LBRY wallet is not the current native RSA owner wallet.
10. **Logout:** [signout.go:15](/Users/bhavya_gor/work/odysee/internal-apis/app/actions/user/signout.go:15) invalidates the current token, optionally all full-scope tokens, and clears verification cache. [frontend app.ts:487](/Users/bhavya_gor/work/odysee/odysee-frontend/ui/redux/actions/app.ts:487) calls that route then clears local state/reloads. Legacy therefore has server invalidation semantics worth preserving; cache propagation across all downstream consumers is not proven by this inspection.

### Do not copy these details uncritically

- URL bearer credentials can enter browser history, proxy logs or analytics. New flow should use short-lived opaque challenge material, immediate history cleanup, no-referrer/no-store responses and no third-party scripts on confirmation surfaces.
- Process-local singleflight plus an ordinary transaction is not evidence of globally atomic, single-use redemption across multiple servers. Test simultaneous redemption explicitly.
- Automatic landing-page confirmation is vulnerable to some mail scanners/prefetchers consuming or approving links. A confirmation interaction is useful but not a claim that all scanners are defeated; codes offer a distinct fallback.
- Legacy DB account merges cannot merge two native signing identities. Existing native objects still belong to their exact original committers.
- Unsolicited approvals are dangerous: “someone entered your email” must not be enough to authorize an unknown initiating device with an ambiguous click.
- Existing email ownership/account matching can change over time. Recycled mailboxes and email changes need a policy, especially for creator recovery.

## Current implementation choices, researched beyond the meeting

| Candidate | What it provides | What we would still own |
| --- | --- | --- |
| Narrow native email challenge boundary | OTP/link issuance and verification within trusted node auth infrastructure | Security-sensitive challenge/session implementation, private consistency, SMTP queue, all account binding and custody |
| Self-hosted Ory/Kratos-style identity service | Maintained email-code flows and identity/session machinery | Operated auth service/DB, node exchange, account-wallet binding; evaluate pinned self-hosted edition rather than assuming hosted documentation parity |
| Self-hosted Supabase Auth/GoTrue | Email links or codes, configurable callbacks/templates and SMTP | External auth DB/service, secure assertion exchange, issuer pinning and recovery binding; no need to move content into Supabase |
| Better Auth narrow service | Pluggable link/OTP/passkey flows in TypeScript | Additional runtime/storage, auditing selected version and defaults, node session exchange; not a reason to add SSR product serving |
| Auth.js email service | SMTP token flow with database-backed verification | Auth service/database plus native session/custody integration; not a static-only solution |
| Managed issuer (e.g. Auth0) | Operated challenge/delivery/auth operations | Vendor cost/outage/deletion/export risk, explicit account binding, verify cross-browser policy before choosing |
| Existing legacy issuer bridge | Current user recognition and familiar email UX | Hardened one-time proof exchange and retirement plan; retains legacy service availability/trust during migration |

Primary sources: [Ory email codes](https://www.ory.com/docs/network/kratos/passwordless/one-time-code), [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Supabase self-hosted templates](https://supabase.com/docs/guides/self-hosting/custom-email-templates), [Better Auth magic links](https://better-auth.com/docs/plugins/magic-link), [Auth.js Nodemailer](https://authjs.dev/getting-started/providers/nodemailer), [Auth0 browser/device restriction](https://support.auth0.com/center/s/article/passwordless-magic-link-error-The-link-must-be-opened-on-the-same-device-and-browser-from-which-you-submitted-your-email-address).

Notable selection traps: Better Auth currently documents plain-token storage as default (choose hashed storage) and requires atomic get-and-delete when using secondary verification storage. Auth.js requires a database even with JWT sessions. Supabase documents email prefetching and tracking-link pitfalls; choose configured behavior deliberately, not an SDK default. [Better Auth configuration](https://better-auth.com/docs/plugins/magic-link), [Auth.js](https://authjs.dev/getting-started/providers/nodemailer), [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

No vendor was installed, priced or security-audited. These are implementation candidates, not recommendations to buy. Email-based login is lower assurance than phishing-resistant authenticators; NIST explicitly excludes email as an out-of-band authenticator in its assurance framework. This does not prohibit consumer email login, but we must not market it as equivalent to passkeys. [NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/).

## Concrete native fit

Keep the static manifest and generic product messages unchanged. Add only an approved authentication boundary, not comment/upload/profile CRUD endpoints. If using an external issuer, redirect through its first-party authentication surface and exchange a one-use, audience-bound authorization result at the trusted node; do not re-enable direct Lbryio product calls in browser code. The current name-only signup remains available unless the team explicitly changes that product contract.

Proposed private records (not public `/id` messages):

- `account`: stable random account ID, native owner address, custody-wallet handle, status/version.
- `method_binding`: account ID, issuer plus stable subject, method type, assurance, enrolled/revoked timestamps. Email lookup encrypted/private; do not publish even unsalted email hashes.
- `challenge`: random ID, hashed random link secret or protected code verifier, purpose, target account/issuer, initiating browser binding, intended origin/node audience, expiry, attempts, consumed state.
- `session`: opaque per-device identifier, account ID, creation/expiry, revocation version, assurance and recent-auth time.
- `migration_binding`: immutable legacy user identifier, evidence digest/version, approved native account, migration status; sensitive evidence remains private.

Pseudoflow for returning login:

```text
Manifest starts login -> trusted auth boundary creates bound challenge
Email link confirms explicit device request OR user types code into original tab
Auth boundary atomically consumes challenge -> verified stable subject
Private registry resolves exactly one existing account + hosted wallet
Node issues fresh revocable session -> existing secret-provider signing boundary
Generic /id writes use the same native committer as before
```

Binding a method to an already active native account requires proof of that current account **and** successful new-method verification. Do not trust a browser-supplied owner address or choose a fresh RSA wallet on every login. Concurrent enrollment requires a unique issuer/subject binding and idempotent wallet creation. Registry/custody loss must fail closed, not silently create a replacement account.

Cross-device link design alternatives:

1. **Code into initiating tab:** simplest predictable browser targeting. Email can open anywhere; code stays bound to the original challenge. Enforce attempt limits and resist phishing; “short code” is not automatically secure.
2. **Approve original tab:** retain legacy familiarity, but show recognizable browser/device and a matching challenge phrase, explicit approval and expiry. Do not silently approve through GET. The original tab proves its binding before session issuance.
3. **Sign into clicked browser:** deliberately separate choice, not accidental side effect. Rebind/restart with explicit consent and protect against attacker-initiated account/session substitution. Never give both browsers authority by default.

The cookie/session issuance boundary must handle HttpOnly/Secure/SameSite and CSRF correctly; blanket Strict cookies may break cross-site callback context, so test the selected callback flow rather than copying a flag recipe. Multi-origin community nodes should not receive a general credential capable of exporting the user's wallet.

## Migration strategies

### A. Temporary legacy authentication bridge

User chooses “Continue with existing Odysee account”; existing issuer performs login; node consumes a short-lived signed, audience-bound assertion or server-side exchange result with stable legacy subject and nonce. Never forward a legacy long-lived bearer token as a permanent native credential. Provision/bind the native account exactly once. Keep existing native users separate until explicit two-sided linking.

Pros: recognizable login, existing account inventory and support operations. Cons: legacy dependency, subject normalization/merge history, outages, confused-deputy risk. The inspected legacy code does not already supply the proposed assertion protocol; it is new work.

### B. Native replacement email login

New issuer verifies mailbox access and binds to native account. Legacy lookup can be a server-side migration check, not browser alternate product mode. Email alone does not prove ownership of a channel whose key/hosted-wallet association is missing. Existing users need an explicit migration evidence policy. Pros: independent future operations. Cons: double-account risk, mailbox lifecycle/recovery policy, new delivery/support burden.

### C. Combined transition (strongest candidate for evaluation)

Bridge first verified legacy access once; record a private stable binding; enroll native email/passkey/recovery methods while the user still controls the account. Subsequent login uses native methods. Make migration opt-in and resumable, distinguish “account connected” from “channels/content imported.” Native writes remain native; imports retain provenance and historical authorship.

Creator proof choices require separate approval: channel-key signature over native account/nonce; or a tightly scoped attestation from an authorized legacy operator based on verified hosted-wallet/channel association. Public channel ID, matching profile name or mailbox text is insufficient. Decide transfer, suspension, compromised legacy accounts and appeals policies before launch.

## User journeys and adoption hypotheses

| User | Desired experience | Failure to avoid | Measure |
| --- | --- | --- | --- |
| Guest viewer | Watch without account; save/follow prompts optional recovery enrollment | Forced email before playback | Guest-to-follow completion, prompt dismissal |
| Returning legacy viewer | Familiar email entry, clear original-tab completion | Unexpected empty account after success | Returning-login success; wrong/empty-account reports |
| Native cookie-only user | “Protect this account” without losing playlists | Email link creates second wallet | Same-owner/private-data checks, enrollment completion |
| Mobile user | Read mail in another app/browser and finish predictably | Link opens mail webview but intended browser remains stuck | Completion by mail client/browser pair |
| Creator | Recognize channels and recovery options before posting | Email-only silent ownership reassignment | Proven channel migration, support escalations |
| TV/shared computer | Approve a named device from phone; explicit logout | Another person's cookie/session survives | Pairing success, revoke latency |

These are hypotheses, not measured Odysee conversion claims. Test link-only against code-first plus optional link, segmented by returning/new users and mobile/desktop. Track median/p95 delivery-to-completion, resend rate, spam-folder complaints, timeout, account-collision rate and 7/30-day return success. Do not log raw email, codes, full URLs or wallet material for analytics. Do not optimize conversion by silently weakening recovery/creator security.

## Rollout, rollback and operations

1. Inventory deployed legacy versions, sender/provider reputation, account merge rules and current Google branch. Agree issuer/subject and recovery policy.
2. Disposable mail sandbox plus two trusted nodes: prove native same-owner resume and encrypted historical-data access; hostile replay/concurrency fixtures first.
3. Opt-in staff/creator cohort, then bounded returning-user cohort. Keep legacy login available while new enrollment/restore is proven. No mandatory migration deadline until support is ready.
4. Observe account integrity as primary gate, then delivery/conversion and operational load. Expand only with durable registry/custody backup and revocation checks.
5. Rollback disables new enrollment/new issuer acceptance without deleting bindings/wallets or rewriting public messages. Existing legitimate sessions follow explicit expiry/revocation policy. Never “rollback” by assigning a different wallet. Emergency compromised-issuer rejection is distinct from normal cohort rollback.

Costs to estimate: mail volume including abusive resend traffic; queue/retry/storage; sender reputation, SPF/DKIM/DMARC setup; bounce/complaint handling; private registry and custody backups; issuer/runtime maintenance; security review; localization/accessibility; support for lost mailbox, corporate filters and account collisions. No unsourced price estimate or conversion promise.

## Acceptance tests before selecting this path

- Same-device, different-device, different-browser, private window, mail webview, original tab closed, expired/reordered links and multiple simultaneous requests.
- Scanner GET/HEAD and scripted previews do not silently grant an attacker-controlled session; explicit code fallback succeeds.
- Challenge replay after success, concurrent consume across nodes, expired token, wrong purpose/audience/origin, bad browser binding, repeated code guesses, invalid callback and rate-limit bypass fail safely.
- Account email change/recycled mailbox, plus aliases/case/Unicode normalization; no invented provider-independent dot/plus collapsing.
- Link email method to existing cookie account; already-bound method to different native wallet must produce conflict and recovery guidance, not merge.
- First login racing on two nodes resolves one account/wallet; lost response can resume safely without consuming twice or creating another account.
- Revoke session then replay old credential on every trusted node; old private-wallet export is a different compromise case and must be documented.
- Restore with original node absent; same native owner edits original content and opens old private playlists/settings.
- Legacy login success alone cannot claim arbitrary creator channels; migration provenance survives retry and partial failure.
- Mail queue/provider outage preserves account identity; “send accepted” is not “delivered.” No credential/email leakage through analytics, referrers, public message storage or logs.

Token and recovery safety baseline: [OWASP forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). Apply its random, expiring, single-use, rate-limited token principles without treating password reset and arbitrary account linking as the same operation.

## Questions to bring to the meeting

1. Preserve legacy approve-original-tab behavior, switch to code-first, or offer both with explicit browser targeting?
2. Is mailbox access sufficient for ordinary login only, or also creator recovery and new-factor replacement? What requires stronger proof/cooldown?
3. Can the legacy team issue a stable-subject, one-use migration assertion and audited channel-ownership evidence?
4. Who owns the private account-binding registry, consistency and custody restoration across trusted nodes?
5. Can Ayush's Google contract accept other verified issuers without another wallet being minted?
6. Is running an auth-only self-hosted service acceptable, or must the boundary be entirely in HyperBEAM? Neither choice changes generic product storage.
7. What is the exit plan if the email/legacy issuer disappears or denies the user access?

**Recommended next decision, not implementation:** compare combined-transition email login against passkey-primary enrollment using the same private account/session contract. Preserve an easy familiar path for legacy users, but avoid making perpetual mailbox access the only way to retain control of their native account.
