# Plan: end-to-end wallet migration (close the two-halves seam)

Status: plan. Companion to `wallet-migration.md` (the crux + format investigation)
and the migration code on `victor/port-auth-migration` (`lbry_channel_key`,
`hb_lbry_channel_key_test`, `migration_imports_real_lbry_channel_keys_test`).

## The problem this closes

Migration is currently proven in **two halves that never run in one flow**:

1. **Decrypt half** — real encrypted wallet files pack/decrypt with lbry-sdk's own
   crypto (scrypt N=8192/r=16/p=1 → AES-256-CBC; empty-password cohort is
   decryptable). This lives **only in `scripts/gen-lbry-channel-keys.py`** — a
   throwaway generator, not in any importer the product would use.
2. **Import half** — a channel PEM → JWK → `~secret@1.0` import → the account
   signs with the original key, byte-for-byte. Proven by the Erlang suite.

Nothing runs **decrypt → extract channel key → PEM→JWK → import → sign** as one
continuous path. That single seam is what a reviewer will (rightly) poke, and it
is the difference between "migration prototype" and "migration demonstrated".

## The architectural constraint that shapes the design

The node must stay **password-blind**: the sync password decrypts the wallet, and
the node must never see it (it would otherwise be a custodial secret the operator
could harvest). So **decryption belongs in the importer — the client or a TEE —
and the node only ever receives a JWK.** This is not a limitation to work around;
it is the correct trust boundary. "End-to-end in the node" is therefore the wrong
target. The right target is: *importer decrypts + converts; node imports + signs*,
run as one flow.

Consequence for tooling: Erlang/OTP has **no native scrypt**, which is fine —
the node should not be doing scrypt anyway. scrypt lives in the importer
(python harness for tests; JS in the browser for the demo).

## Deliverable A — an importer harness that runs the whole chain (the test)

Build a small importer (outside the node) that, given an encrypted wallet file +
password, runs every step and drives a live node, so one test asserts blob-in →
signature-out.

Steps to implement:
1. **Decrypt + extract** — reuse lbry-sdk's `better_aes_decrypt` (already proven
   in the generator) to turn an encrypted wallet file + password into wallet JSON,
   then read `accounts[].certificates` → the channel PEM(s). Empty-password and
   real-password cases both covered.
2. **Convert** — PEM → JWK. This already exists as `lbry_channel_key:pem_to_jwk/1`
   on the node side; the importer either calls a tiny JWK conversion of its own or
   posts the PEM and lets a node-side conversion endpoint do it. Prefer converting
   in the importer so the node's import API stays "JWK in".
3. **Import** — POST the JWK to `~secret@1.0/import`, keyed to the account (the
   existing `import_wallet` path in `hb_odysee_auth_test`).
4. **Sign + verify** — have the node sign a message as that account and verify the
   signer address equals the address derived from the original channel key.
5. **One test** asserts the full chain for a real encrypted wallet file (both
   cohorts), replacing the current split where step 1 lives only in python and
   steps 2–4 only in Erlang.

Open decision to make while building: does the importer post a **PEM** (node
converts) or a **JWK** (importer converts)? Recommendation: JWK-in keeps the node
import API single-shaped and the LBRY-specific decode on the client side where the
rest of the LBRY crypto already is.

## Deliverable B — make the demo node-driven (removes the in-browser stand-in)

Today `odysee-migrate-demo.html` signs **in-browser** with an embedded key,
because HTTP round-tripping the node's sign/verify was measured to be fragile.
With Deliverable A in place, the demo becomes the honest thing:

1. Browser is the importer: it already has noble-secp256k1; add a small JS scrypt
   (e.g. an inlined `scrypt-js`, CSP-safe) + AES-CBC (WebCrypto has AES-CBC) to
   run `better_aes_decrypt` in-page.
2. Flow: paste `auth_token` (validated against the node, as today) + provide an
   encrypted wallet file + its password → browser decrypts → extracts the channel
   PEM → converts to JWK → **imports to the node** keyed to the account.
3. The **node** then signs a message and the browser verifies — so the signature
   comes from the hosted wallet on the node, not a browser stand-in. Tamper still
   demonstrates rejection.
4. Keep an embedded sample encrypted wallet file (empty-password) so the demo
   needs no real credential, with an optional "use your own" path.

This makes the demo assert the real product path (client decrypts, node hosts +
signs) end to end.

## Sequencing

1. Deliverable A first (the test harness + one continuous test) — it is what
   converts the migration claim from "two halves" to "demonstrated", and it is a
   prerequisite for a node-driven demo.
2. Deliverable B second (rework the demo onto the node path), reusing A's decrypt
   + convert logic ported to JS.

## Out of scope (still)

- Wiring the real `sync/get` transport (endpoint/param confirmation) — the harness
  takes an encrypted wallet file as input; fetching it from the live sync service
  is a later step and needs the frontend transport confirmed.
- TEE-hosted decryption — the in-TEE importer variant is the production custody
  story; the harness/demo stand in for it with client-side decrypt.
