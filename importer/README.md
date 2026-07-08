# LBRY wallet -> HyperBEAM migration importer (client/TEE-side)

`decrypt (scrypt+AES-CBC) -> extract channel PEM -> PEM->JWK`. The node stays
password-blind; it only ever receives the JWK. Verified against lbry-sdk's own
encrypted output (`node test.mjs`).

Remaining glue to finish end-to-end (blob->signature), reusing already-proven
pieces: feed the JWK to `~secret@1.0/import` keyed to the account (see
`hb_odysee_auth_test:migration_imports_real_lbry_channel_keys_test`) and sign
with the HB-native signer on `victor/product-events-native`
(`web/src/routes.js:hbSignedHeaders`).
