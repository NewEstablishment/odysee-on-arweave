#!/usr/bin/env python3
"""Generate the wallet-file matrix the migration sweep (sweep.mjs) runs the
importer over. Each case is a genuine LBRY wallet-sync payload built with the
SDK's own crypto (better_aes_encrypt: scrypt N=8192/r=16/p=1 + AES-256-CBC),
covering the cohorts and adversarial cases the importer must handle: empty vs
set password, single vs multi channel, the Wallet.pack zlib framing vs the raw
primitive, and malformed / wrong-password / tampered blobs that must be
rejected. Writes fixtures/*.b64 and fixtures/manifest.json (expected outcomes +
known scalars for byte-for-byte checks).

    /tmp/mvenv/bin/pip install coincurve cryptography asn1crypto
    PYTHONPATH=/home/user/repos/HB5/lbry-sdk /tmp/mvenv/bin/python3 gen-sweep-fixtures.py
"""
import base64
import json
import os
import zlib

from lbry.crypto.crypt import better_aes_encrypt
from coincurve import PrivateKey as cPrivateKey

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures")


def wallet_with(n_channels):
    keys = [cPrivateKey() for _ in range(n_channels)]
    certificates = {f"fakeaddr{i}": k.to_pem().decode() for i, k in enumerate(keys)}
    wallet = {
        "version": 1, "name": "testwallet", "preferences": {},
        "accounts": [{
            "ledger": "lbc_mainnet", "name": "Account #1",
            "seed": "test seed words here", "private_key": "tprvFAKExprv",
            "certificates": certificates,
        }],
    }
    scalars = [k.secret.hex() for k in keys]
    return wallet, scalars


def write(name, data):
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)


def main():
    os.makedirs(OUT, exist_ok=True)
    cases = []

    # 1. empty-password, single channel, raw primitive (no zlib framing).
    w, sc = wallet_with(1)
    write("empty-single-raw.b64", better_aes_encrypt("", json.dumps(w).encode()))
    cases.append({"file": "empty-single-raw.b64", "password": "", "expectKeys": sc})

    # 2. empty-password, single channel, Wallet.pack zlib framing.
    w, sc = wallet_with(1)
    write("empty-single-zlib.b64", better_aes_encrypt("", zlib.compress(json.dumps(w).encode())))
    cases.append({"file": "empty-single-zlib.b64", "password": "", "expectKeys": sc})

    # 3. password-set, single channel (correct password recovers the key).
    w, sc = wallet_with(1)
    write("password-single.b64", better_aes_encrypt("hunter2", json.dumps(w).encode()))
    cases.append({"file": "password-single.b64", "password": "hunter2", "expectKeys": sc})

    # 4. password-set blob opened with the WRONG password must fail.
    cases.append({"file": "password-single.b64", "password": "wrong", "expectError": True})

    # 5. empty-password, multi-channel (all keys recovered).
    w, sc = wallet_with(3)
    write("empty-multi.b64", better_aes_encrypt("", json.dumps(w).encode()))
    cases.append({"file": "empty-multi.b64", "password": "", "expectKeys": sc})

    # 6. tampered ciphertext: flip a byte in the AES body -> reject.
    w, _ = wallet_with(1)
    blob = better_aes_encrypt("", json.dumps(w).encode())
    raw = bytearray(base64.b64decode(blob))
    raw[-1] ^= 0x01
    write("tampered.b64", base64.b64encode(bytes(raw)))
    cases.append({"file": "tampered.b64", "password": "", "expectError": True})

    # 7. malformed garbage that is not a valid blob at all.
    write("malformed.b64", base64.b64encode(b"not-a-wallet-blob"))
    cases.append({"file": "malformed.b64", "password": "", "expectError": True})

    # 8. a valid wallet with NO channels -> legitimately recovers zero keys.
    empty_wallet = {"version": 1, "name": "testwallet", "preferences": {},
                    "accounts": [{"ledger": "lbc_mainnet", "name": "Account #1",
                                  "certificates": {}}]}
    write("no-channels.b64", better_aes_encrypt("", json.dumps(empty_wallet).encode()))
    cases.append({"file": "no-channels.b64", "password": "", "expectKeys": []})

    # 9. a certificate value that is not a PEM string -> reject, don't pass through.
    bad_wallet = {"version": 1, "name": "testwallet", "preferences": {},
                  "accounts": [{"ledger": "lbc_mainnet", "name": "Account #1",
                                "certificates": {"fakeaddr0": 12345}}]}
    write("bad-cert.b64", better_aes_encrypt("", json.dumps(bad_wallet).encode()))
    cases.append({"file": "bad-cert.b64", "password": "", "expectError": True})

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({"cases": cases}, f, indent=2)
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
