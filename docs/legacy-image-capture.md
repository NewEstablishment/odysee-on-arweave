# Legacy image capture — bounded staging pilot

This operator tool consumes the existing offline image inventory and captures
public HTTPS image bytes into a **private local staging directory**. It is not
a browser backend, HyperBEAM device, publishing tool or account migration.
No node, wallet, legacy account, API credential or search index is needed.

`scripts/capture_legacy_images.py` is Python, separate from the Node inventory
script. It uses Python's standard-library URL/IP/TLS and filesystem primitives,
with hash-pinned Pillow for actual PNG/JPEG/WebP/GIF decoding. Run capture on Linux
or in the supplied Linux container. macOS offline validation works, but capture
fails closed because macOS refuses the worker address-space limit.

## Prepare and inspect

Use a reviewed **public claim export**, not raw account records, signed URLs or
credential-bearing URLs. Keep the input and staging files outside the checkout.
The inventory still does not prove the exported outpoints/URLs against the chain.
Channel banner coverage requires full channel records, not only search exports.

```sh
node --experimental-strip-types scripts/plan-legacy-images.mjs /absolute/public-claims.json > /absolute/image-plan.json
python3 -B scripts/capture_legacy_images.py /absolute/image-plan.json --allow-host images.example
```

The second command is **offline validation by default**: it neither resolves
DNS nor downloads anything and creates no checkpoint. `url_policy_eligible`
means only that the URL passes syntax/scheme/host rules, not that it is safe to
connect, available, decodable or approved as authentic historical media.

Review the inventory's host counts before selecting `--allow-host`. There is
no built-in approved legacy-host list. Specify exact lowercase hosts individually,
including any approved redirect hosts; wildcard/subdomain approval is not implied.
Do not blindly approve every host from an untrusted plan.

## Build and capture

Build with **only `scripts/` as Docker context**; never include node stores,
wallets, staging data or the whole workspace in the build context.

```sh
docker build --target runtime -f scripts/legacy-image-capture.Dockerfile -t odysee-image-capture:local scripts
```

Create a dedicated empty staging directory with mode `0700`. Substitute actual
absolute paths below; mount only the reviewed plan and staging directory, not a
home directory or Docker socket. This invocation opts into external reads:

```sh
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --cpus=1 --pids-limit=32 \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,source=/absolute/image-plan.json,target=/input/plan.json,readonly \
  --mount type=bind,source=/absolute/image-stage,target=/stage \
  odysee-image-capture:local /input/plan.json \
  --allow-host images.example --output /stage --capture --limit 25
```

Normal container networking is needed for a real capture. Do not use host
networking or pass account/API credentials. The client ignores proxy environment
variables, sends no authorization/cookies, and has no insecure-TLS/local-IP bypass.
Add deployment-level egress restrictions for a production runner.

For Linux without Docker, install `scripts/legacy-image-requirements.txt` with
`pip install --require-hashes --only-binary=:all: -r scripts/legacy-image-requirements.txt`
into a Python 3.14 virtualenv and run the same CLI. Hashes cover Linux/macOS
arm64/x86_64 CPython 3.14 wheels; offline validation alone needs only Python 3.11+.
The container adds whole-process
memory/CPU/process/filesystem isolation; subprocess limits alone are not a sandbox.
Pinned dependencies/base image need periodic security review and updates.

## Limits and provenance

| Boundary | Pilot behavior |
| --- | --- |
| Input | At most 8 MiB / 1,000 jobs; validate deterministic inventory IDs; allow at most 32 hosts. |
| Work | Sequential; 25 jobs by default, `--limit` 1–100 per invocation; no automatic retries. |
| Network | HTTPS/443 only; every DNS answer must be public; pin the checked literal IP while retaining hostname TLS validation. |
| Redirects | At most 3, manually followed; revalidate host, URL and DNS at every hop; reject credentials, queries and fragments. |
| Response | 200 only; 404/410 are missing; reject compressed transfer content, bad MIME/length and bodies over 5 MiB. Chunked HTTP framing is supported. |
| Worker | 30-second parent deadline including DNS; 8-second socket timeout; 12 CPU seconds; 1 GiB address-space limit; no file output/core dump. |
| Decode | PNG/JPEG/WebP/GIF, matching declared MIME; 8192 per dimension, 16 million pixels/frame, 100 frames, 32 million total frame pixels. Decode every accepted frame. |
| Disk | Bytes named by SHA-256, receipts also include SHA-384, size, dimensions/frames, capture time, source URL/outpoint/role and redirect chain. |

Staged originals are **not rewritten or sanitized**. No EXIF stripping,
malware scanning, derivative generation, policy approval or safe-public-serving
claim is made. Keep them quarantined, not under a web document root.

Receipts explicitly say `evidence: unverified-export-current-url-capture`,
`historical_bytes_verified: false`, and `published: false`. A matching local
content hash proves what was captured, not what the URL served historically.
Neither a source URL nor a future migration signer's signature establishes
creator ownership. Query/credential-bearing URLs are rejected, but secrets
embedded in an otherwise ordinary path cannot be detected reliably—review exports.

## Resume, failures and recovery

Run the same command with the **same plan and host policy**. Captured jobs are
not fetched again; every recorded blob is rechecked for size and both hashes.
Different roles/outpoints keep distinct receipts even if their bytes deduplicate.
Jobs not attempted because of the per-run limit remain `pending` in the summary.

`checkpoint.json` is bound to the normalized plan digest, policy version and
host list. A non-blocking file lock rejects concurrent writers. Each blob is
written before its receipt; checkpoint replacement uses temporary files, fsync
and rename. A crash can leave an orphan blob but cannot mark an absent blob as
successfully captured. Unacknowledged jobs may refetch a changed URL on resume;
their unreferenced old blobs are retained, never overwritten.

- `captured`: validated bytes/receipt staged, not published.
- `missing`: HTTP 404/410. `--retry-failed` retries these explicitly.
- `failed`: network, HTTP, deadline or worker/resource error. Retry is explicit.
- `rejected`: host/IP/redirect/type/size/decode policy violation. Not retried by
  `--retry-failed`; review and use a new staging directory/plan for a changed policy.

Exit `0` means no recorded failure/missing/rejection (check `pending` separately),
`2` means those job outcomes exist, and `1` means setup/input/checkpoint failure.
Failures log fixed reason codes, not response bodies, headers or raw exceptions.

Corrupt/missing recorded blobs, unsafe files/symlinks, unrelated files in the
output directory, or a changed plan/policy stop the run. Restore from a trusted
backup or preserve the old staging directory and start a reviewed new one.
Do not delete checkpoints to manufacture a successful migration. The tool never
automatically garbage-collects orphan blobs. Check free disk before repeated runs;
the per-run bound is not a filesystem quota. Power-loss/backup recovery is not
certified by atomic-rename tests.

## Verification

```sh
node --experimental-strip-types --test scripts/plan-legacy-images.test.mjs
docker build --target test -f scripts/legacy-image-capture.Dockerfile -t odysee-image-capture:test scripts
docker run --rm --read-only --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --cpus=1 --pids-limit=32 --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  odysee-image-capture:test
```

Host interoperability/fixture tests (pinned Pillow virtualenv and OpenSSL):

```sh
python -B -m unittest discover -s scripts -p 'test_capture_legacy_images.py' -v
```

Tests use ephemeral local TLS with a test-only socket mapping/trust root, real
decoders, and private temporary staging. The production tool has no such override.
Node inventory interoperability runs on the host; Linux worker limits and capture
CLI run in the container. No live legacy-host capture, node publication, restart
durability, migration mapping consumption or production-scale acceptance is claimed.

2026-09-28 results: 19 importer scenarios exercised across both environments
(17 pass/2 Linux-only skips on macOS; 18 pass/1 host-Node interoperability skip
in the network-disabled Linux container). All four existing inventory tests
pass, as do Python lint/format, container runtime entry-point smoke and
`git diff --check`. Frontend/backend suites were not rerun for this operator-only
slice; earlier native-image acceptance remains separately recorded.

Next: a reviewed small real-export capture, then a separately authorized generic
write publisher with exact-byte readback, and an explicit migration-mapping trust
contract. See [image workstream](image-storage-migration.md).

## Security references

The fetch boundary follows the allowlist, all-address validation and redirect
concerns in [OWASP's SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
Decoder budgets and process isolation address risks described by
[Pillow's security guidance](https://pillow.readthedocs.io/en/stable/handbook/security.html);
they do not make arbitrary captured images trusted content.
