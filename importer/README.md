# LBRY wallet -> HyperBEAM migration importer (client/TEE-side)

`decrypt (scrypt+AES-CBC) -> extract channel PEM -> PEM->JWK`. The node stays
password-blind; it only ever receives the JWK. Run `node test.mjs`.

## The end-to-end migration pipeline (one flow, all proven)

1. **blob -> decrypt -> PEM -> JWK** (this module) — verified against lbry-sdk's
   own encrypted wallet-sync output (`fixture-wallet-empty-pw.b64`); the migrated
   scalar is byte-for-byte the original channel key.
2. **JS JWK == Erlang codec JWK** — this module's `channelPemToJwk` reproduces,
   byte-for-byte, the JWK that `lbry_channel_key:pem_to_jwk` produces for the
   same PEM (`fixture-erlang-corpus-vector.json`, the first entry of the Erlang
   migration corpus in `hyperbeam/src/core/include/lbry_test_keys.hrl`).
3. **JWK -> import -> sign** — that exact JWK, fed to `~secret@1.0/import` keyed
   to an account, makes the account's sessions sign with the migrated channel
   identity (proven in `hb_odysee_auth_test:migration_imports_real_lbry_channel_keys_test`).

Because step 2 joins the two implementations at a shared key, the JS decrypt is a
validated upstream extension of the proven Erlang import->sign path: the node
never sees the password, only the JWK, and the JWK it receives is exactly the one
the import path already carries through to a signature.
