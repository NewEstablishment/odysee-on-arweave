"""Bounded URL capture into a private staging directory. Never publishes images.

Input: plan-legacy-images.mjs JSON. Captured bytes are current URL observations,
not authenticated historical media or creator-authorized migration mappings.
Offline validation: Python 3.11+ on POSIX. Capture: Linux/Python 3.14 and the pinned
legacy-image-requirements.txt (use the supplied container on macOS).
"""

import argparse
import base64
import contextlib
import fcntl
import hashlib
import http.client
import io
import ipaddress
import json
import os
import re
import resource
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import warnings
from pathlib import Path
from urllib.parse import urljoin, urlsplit

POLICY = "odysee-image-capture-policy@1"
MAX_BYTES = 5 * 1024 * 1024
MAX_PLAN_BYTES = 8 * 1024 * 1024
MAX_DIMENSION = 8192
MAX_PIXELS = 16_000_000
MAX_FRAME_PIXELS = 32_000_000
MAX_FRAMES = 100
MAX_REDIRECTS = 3
JOB_SECONDS = 30
HEX = re.compile(r"[0-9a-f]{64}\Z")
HOST = re.compile(
    r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\Z"
)
MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
    "GIF": "image/gif",
}


class CaptureError(Exception):
    def __init__(self, code, status="rejected"):
        super().__init__(code)
        self.code, self.status = code, status


def digest(data, algorithm="sha256"):
    return hashlib.new(algorithm, data).hexdigest()


def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def approved_hosts(values):
    result = sorted(set(values))
    if len(result) > 32 or any(not HOST.fullmatch(host) for host in result):
        raise CaptureError("invalid-approved-host")
    return result


def checked_url(raw, hosts):
    if (
        not isinstance(raw, str)
        or len(raw) > 4096
        or not raw.isascii()
        or any(ord(c) <= 32 or ord(c) == 127 for c in raw)
    ):
        raise CaptureError("invalid-url")
    try:
        url = urlsplit(raw)
        if url.scheme != "https":
            raise CaptureError("https-required")
        if (
            url.username is not None
            or url.password is not None
            or "?" in raw
            or "#" in raw
        ):
            raise CaptureError("credential-or-query-url")
        if url.port not in (None, 443) or not HOST.fullmatch(url.hostname or ""):
            raise CaptureError("invalid-host-or-port")
        if url.hostname not in hosts:
            raise CaptureError("host-not-approved")
        return url
    except ValueError:
        raise CaptureError("invalid-url") from None


def public_ip(address):
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if "%" in address or not ip.is_global or ip.is_multicast or ip.is_reserved:
        return False
    if ip.version == 4:
        return not any(
            ip in ipaddress.ip_network(net)
            for net in ("192.0.0.0/24", "192.88.99.0/24")
        )
    # Fail closed on mapped/translated/transition addresses, not just ::1/ULA.
    return (
        ip in ipaddress.ip_network("2000::/3")
        and ip.sixtofour is None
        and ip.teredo is None
        and ip not in ipaddress.ip_network("2001::/23")
        and ip not in ipaddress.ip_network("3fff::/20")
    )


def resolve_public(host):
    answers = socket.getaddrinfo(
        host, 443, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
    )
    if (
        not answers
        or len(answers) > 32
        or any(
            family not in (socket.AF_INET, socket.AF_INET6)
            or not public_ip(sockaddr[0])
            for family, _, _, _, sockaddr in answers
        )
    ):
        raise CaptureError("non-public-dns-answer")
    return answers[0][0], answers[0][4][0]


class PinnedHTTPS(http.client.HTTPSConnection):
    """Connect to the checked literal IP without a second hostname resolution.

    TLS still authenticates the original hostname. No proxy, cookie jar, auth
    carrier, automatic redirect or cross-request connection reuse is involved.
    """

    def __init__(self, host, address):
        super().__init__(host, timeout=8, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        family, address = self.address
        sock = socket.socket(family, socket.SOCK_STREAM)
        try:
            sock.settimeout(self.timeout)
            sock.connect((address, 443))
            if ipaddress.ip_address(sock.getpeername()[0]) != ipaddress.ip_address(
                address
            ):
                raise CaptureError("peer-address-mismatch")
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def download(source, hosts):
    current, visited = source, []
    for hop in range(MAX_REDIRECTS + 1):
        url = checked_url(current, hosts)
        if current in visited:
            raise CaptureError("redirect-loop")
        visited.append(current)
        address = resolve_public(url.hostname)
        connection = PinnedHTTPS(url.hostname, address)
        try:
            connection.request(
                "GET",
                url.path or "/",
                headers={
                    "Accept": ", ".join(MIME.values()),
                    "Accept-Encoding": "identity",
                    "User-Agent": "Odysee-Image-Capture/1.0",
                    "Connection": "close",
                },
            )
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if hop == MAX_REDIRECTS or not location:
                    raise CaptureError("redirect-limit-or-missing-location")
                # Reject secrets even in a relative redirect before storing it.
                if any(c in location for c in ("?", "#")) or any(
                    ord(c) <= 32 for c in location
                ):
                    raise CaptureError("unsafe-redirect")
                current = urljoin(current, location)
                checked_url(current, hosts)
                continue
            if response.status in (404, 410):
                raise CaptureError(f"http-{response.status}", "missing")
            if response.status != 200:
                raise CaptureError(f"http-{response.status}", "failed")
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise CaptureError("encoded-response")
            content_type = (
                response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
            )
            if content_type not in MIME.values():
                raise CaptureError("unsupported-content-type")
            length = response.getheader("Content-Length")
            if length is not None and (
                not re.fullmatch(r"[0-9]+", length) or int(length) > MAX_BYTES
            ):
                raise CaptureError("invalid-or-large-content-length")
            chunks, size = [], 0
            while True:
                chunk = response.read(min(65536, MAX_BYTES + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_BYTES:
                    raise CaptureError("image-too-large")
            if not size or (length is not None and size != int(length)):
                raise CaptureError("empty-or-truncated-response")
            return b"".join(chunks), content_type, visited
        finally:
            connection.close()
    raise CaptureError("redirect-limit")


def decode_image(data, content_type):
    from PIL import Image, ImageFile

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data), formats=list(MIME)) as image:
                if MIME.get(image.format) != content_type:
                    raise CaptureError("image-mime-mismatch")
                image.verify()
            with Image.open(io.BytesIO(data), formats=list(MIME)) as image:
                width, height = image.size
                frames = getattr(image, "n_frames", 1)
                if (
                    not 0 < width <= MAX_DIMENSION
                    or not 0 < height <= MAX_DIMENSION
                    or width * height > MAX_PIXELS
                    or not 0 < frames <= MAX_FRAMES
                    or width * height * frames > MAX_FRAME_PIXELS
                ):
                    raise CaptureError("image-decode-budget")
                pixels = 0
                for frame in range(frames):
                    image.seek(frame)
                    w, h = image.size
                    pixels += w * h
                    if (
                        w > MAX_DIMENSION
                        or h > MAX_DIMENSION
                        or w * h > MAX_PIXELS
                        or pixels > MAX_FRAME_PIXELS
                    ):
                        raise CaptureError("image-decode-budget")
                    image.load()
                return {
                    "width": width,
                    "height": height,
                    "frames": frames,
                    "content_type": content_type,
                }
        except CaptureError:
            raise
        except Exception:  # noqa: BLE001 - decoder exceptions become a fixed, non-sensitive rejection code.
            raise CaptureError("invalid-image") from None


def worker(request):
    # Failure to apply limits is an error, never an unbounded fallback. This is
    # process isolation/resource containment, not an OS security sandbox.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
    resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    data, content_type, chain = download(
        request["source_url"], approved_hosts(request["hosts"])
    )
    details = decode_image(data, content_type)
    return {
        "status": "captured",
        **details,
        "redirect_chain": chain,
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sha256": digest(data),
        "sha384": digest(data, "sha384"),
        "size": len(data),
        "body": base64.b64encode(data).decode(),
    }


def run_worker(source, hosts):
    try:
        result = subprocess.run(
            [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "_worker"],
            input=canonical({"source_url": source, "hosts": hosts}),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=JOB_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            return {"status": "failed", "reason": "worker-resource-or-runtime-failure"}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "reason": "job-deadline"}


def bounded_read(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise CaptureError("invalid-or-large-local-file")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise CaptureError("local-file-too-large")
    return data


def load_plan(path):
    plan = json.loads(bounded_read(path, MAX_PLAN_BYTES))
    if (
        not isinstance(plan, dict)
        or plan.get("schema") != "odysee-image-migration-plan@1.0"
    ):
        raise CaptureError("invalid-plan-schema")
    entries = plan.get("entries")
    if not isinstance(entries, list) or len(entries) > 1000:
        raise CaptureError("invalid-plan-size")
    cleaned, seen = [], set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise CaptureError("invalid-plan-entry")
        outpoint, role, source = (
            entry.get(key) for key in ("legacy_outpoint", "role", "source_url")
        )
        if (
            not isinstance(outpoint, str)
            or not re.fullmatch(r"[0-9a-f]{64}:(0|[1-9][0-9]{0,9})", outpoint)
            or role not in ("thumbnail", "avatar", "banner")
            or not isinstance(source, str)
            or len(source) > 4096
        ):
            raise CaptureError("invalid-plan-entry")
        job_id = digest(canonical([outpoint, role, source]))
        if entry.get("job_id") != job_id or job_id in seen:
            raise CaptureError("invalid-or-duplicate-job-id")
        seen.add(job_id)
        # Copy only explicit fields; never import arbitrary exported account data.
        cleaned.append(
            {
                "job_id": job_id,
                "legacy_outpoint": outpoint,
                "role": role,
                "source_url": source,
            }
        )
    return cleaned


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise CaptureError("staging-directory-must-be-private-and-not-symlink")


def regular_file(path):
    info = path.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_nlink != 1
    ):
        raise CaptureError("unsafe-staging-file")


def atomic_write(path, data):
    if path.exists() or path.is_symlink():
        regular_file(path)
    fd, temporary = tempfile.mkstemp(prefix=".capture-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def stage_lock(root):
    private_directory(root)
    if any(
        path.name not in (".lock", "blobs", "checkpoint.json")
        and not path.name.startswith(".capture-")
        for path in root.iterdir()
    ):
        raise CaptureError("output-must-be-dedicated-staging-directory")
    descriptor = os.open(root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        regular_file(root / ".lock")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CaptureError("staging-directory-in-use") from None
        yield
    finally:
        os.close(descriptor)


def capture(entries, root, hosts, limit=25, retry_failed=False):
    """Single writer, one subprocess at a time; every receipt is a checkpoint."""
    root = Path(root).absolute()
    with stage_lock(root):
        private_directory(root / "blobs")
        checkpoint = root / "checkpoint.json"
        identity = {
            "schema": "odysee-image-capture@1.0",
            "policy": POLICY,
            "plan_sha256": digest(canonical(entries)),
            "approved_hosts": hosts,
        }
        state = {**identity, "jobs": {}}
        if checkpoint.exists() or checkpoint.is_symlink():
            regular_file(checkpoint)
            state = json.loads(bounded_read(checkpoint, 32 * 1024 * 1024))
            if any(
                state.get(key) != value for key, value in identity.items()
            ) or not isinstance(state.get("jobs"), dict):
                raise CaptureError("checkpoint-plan-or-policy-mismatch")
        jobs = state["jobs"]
        if not set(jobs).issubset({entry["job_id"] for entry in entries}):
            raise CaptureError("checkpoint-job-mismatch")
        # A corrupt receipt/blob stops the run. Never silently refetch a mutable
        # URL and replace its original capture with different bytes.
        for receipt in jobs.values():
            if not isinstance(receipt, dict) or receipt.get("status") not in (
                "captured",
                "failed",
                "missing",
                "rejected",
            ):
                raise CaptureError("invalid-checkpoint-receipt")
            if receipt["status"] == "captured":
                sha = receipt.get("sha256", "")
                if not isinstance(sha, str) or not HEX.fullmatch(sha):
                    raise CaptureError("invalid-blob-hash")
                blob = root / "blobs" / sha
                regular_file(blob)
                data = bounded_read(blob, MAX_BYTES)
                if (
                    digest(data) != sha
                    or len(data) != receipt.get("size")
                    or digest(data, "sha384") != receipt.get("sha384")
                ):
                    raise CaptureError("captured-blob-corrupt")
        attempted = 0
        for entry in entries:
            previous = jobs.get(entry["job_id"])
            if previous and not (
                retry_failed and previous["status"] in ("failed", "missing")
            ):
                continue
            if attempted >= limit:
                break
            attempted += 1
            try:
                checked_url(entry["source_url"], hosts)
                receipt = run_worker(entry["source_url"], hosts)
            except CaptureError as error:
                receipt = {"status": error.status, "reason": error.code}
            if receipt["status"] == "captured":
                data = base64.b64decode(receipt.pop("body"), validate=True)
                if (
                    not 0 < len(data) <= MAX_BYTES
                    or digest(data) != receipt["sha256"]
                    or digest(data, "sha384") != receipt["sha384"]
                ):
                    raise CaptureError("worker-byte-mismatch")
                blob = root / "blobs" / receipt["sha256"]
                if blob.exists() or blob.is_symlink():
                    regular_file(blob)
                    if bounded_read(blob, MAX_BYTES) != data:
                        raise CaptureError("existing-blob-corrupt")
                else:
                    atomic_write(blob, data)
                receipt.update(
                    {
                        "source_url": entry["source_url"],
                        "legacy_outpoint": entry["legacy_outpoint"],
                        "role": entry["role"],
                        "evidence": "unverified-export-current-url-capture",
                        "historical_bytes_verified": False,
                        "published": False,
                    }
                )
            # Failed sources are identified by job hash; don't persist a rejected
            # credential-bearing URL, response headers, error text or raw body.
            receipt["attempts"] = (previous or {}).get("attempts", 0) + 1
            receipt["attempted_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            receipt["legacy_outpoint"] = entry["legacy_outpoint"]
            receipt["role"] = entry["role"]
            jobs[entry["job_id"]] = receipt
            atomic_write(checkpoint, canonical(state) + b"\n")
        if not checkpoint.exists():
            atomic_write(checkpoint, canonical(state) + b"\n")
        counts = {
            name: sum(r["status"] == name for r in jobs.values())
            for name in ("captured", "failed", "missing", "rejected")
        }
        return {"attempted": attempted, "pending": len(entries) - len(jobs), **counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument(
        "--allow-host",
        action="append",
        default=[],
        help="Exact lowercase DNS name; repeat for redirect hosts.",
    )
    parser.add_argument(
        "--output", type=Path, help="Dedicated private staging directory (0700)."
    )
    parser.add_argument(
        "--capture",
        action="store_true",
        help="Actually fetch approved URLs. Default is offline validation.",
    )
    parser.add_argument(
        "--limit", type=int, default=25, help="Jobs attempted this invocation (1–100)."
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Retry failed/missing jobs, never replace captures.",
    )
    args = parser.parse_args()
    try:
        hosts = approved_hosts(args.allow_host)
        entries = load_plan(args.plan)
        if not 1 <= args.limit <= 100:
            raise CaptureError("invalid-job-limit")
        if not args.capture:
            eligible = 0
            for entry in entries:
                try:
                    checked_url(entry["source_url"], hosts)
                    eligible += 1
                except CaptureError:
                    pass
            print(
                json.dumps(
                    {
                        "mode": "offline-validation",
                        "jobs": len(entries),
                        "url_policy_eligible": eligible,
                        "not_eligible": len(entries) - eligible,
                        "dns_checked": False,
                        "network_requests": 0,
                    }
                )
            )
            return
        if not hosts or not args.output:
            raise CaptureError("capture-requires-approved-hosts-and-output")
        if sys.platform != "linux":
            raise CaptureError("capture-requires-linux-use-container")
        import PIL

        if PIL.__version__ != "12.3.0":
            raise CaptureError("install-pinned-image-requirements")
        summary = capture(entries, args.output, hosts, args.limit, args.retry_failed)
        print(json.dumps(summary))
        if summary["failed"] or summary["missing"] or summary["rejected"]:
            sys.exit(2)
    except CaptureError as error:
        print(f"Image capture stopped: {error.code}", file=sys.stderr)
        sys.exit(1)
    except Exception:  # noqa: BLE001 - CLI must not disclose source URLs or response exception text.
        print(
            "Image capture stopped: local-input-or-runtime-error (no source contents logged)",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    if sys.argv[1:] == ["_worker"]:
        try:
            output = worker(json.loads(sys.stdin.buffer.read(16384)))
        except CaptureError as error:
            output = {"status": error.status, "reason": error.code}
        except Exception:  # noqa: BLE001 - worker protocol exposes only fixed diagnostic codes.
            output = {"status": "failed", "reason": "network-decoder-or-runtime-error"}
        print(json.dumps(output))
    else:
        main()
