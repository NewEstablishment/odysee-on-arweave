"""Offline contracts plus real local TLS/image decoding; no legacy host traffic.

Run with the pinned virtualenv:
  python -B -m unittest discover -s scripts -p 'test_capture_legacy_images.py' -v
"""

import base64
import io
import json
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

import capture_legacy_images as cap
from PIL import Image

HOSTS = ["images.example", "other.example"]
PUBLIC = "93.184.216.34"


def image_bytes(format="PNG", size=(4, 3), **options):
    output = io.BytesIO()
    Image.new("RGB", size, "blue").save(output, format=format, **options)
    return output.getvalue()


def job(path="a.png", role="thumbnail"):
    fields = ["a" * 64 + ":0", role, f"https://images.example/{path}"]
    return dict(
        zip(("legacy_outpoint", "role", "source_url"), fields),
        job_id=cap.digest(cap.canonical(fields)),
    )


def result(data=None):
    data = data or image_bytes()
    return {
        "status": "captured",
        "sha256": cap.digest(data),
        "sha384": cap.digest(data, "sha384"),
        "size": len(data),
        "body": base64.b64encode(data).decode(),
        "content_type": "image/png",
        "width": 4,
        "height": 3,
        "frames": 1,
        "captured_at": "2026-09-28T00:00:00Z",
        "redirect_chain": [job()["source_url"]],
    }


class PolicyTests(unittest.TestCase):
    def test_urls_fail_closed(self):
        for url in [
            "http://images.example/a",
            "https://images.example:444/a",
            "https://images.example./a",
            "https://user:secret@images.example/a",
            "https://images.example/a?secret",
            "https://images.example/a#secret",
            "https://images.example/a?",
            "https://images.example.evil/a",
            "https://sub.images.example/a",
            "https://127.0.0.1/a",
            "https://[::1]/a",
            "https://2130706433/a",
            "file:///etc/passwd",
            "https://images.example/\na",
            " https://images.example/a",
            "https://images.example\\@evil/a",
        ]:
            with self.subTest(url=url), self.assertRaises(cap.CaptureError):
                cap.checked_url(url, HOSTS)
        self.assertEqual(
            cap.checked_url("https://images.example:443/a%20b.png", HOSTS).hostname,
            "images.example",
        )
        for host in [
            "*.example",
            "localhost",
            "images.example.",
            "127.0.0.1",
            "Images.example",
            "a..example",
        ]:
            with self.assertRaises(cap.CaptureError):
                cap.approved_hosts([host])

    def test_ip_ranges_and_mixed_dns(self):
        for ip in [
            "0.0.0.0",
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.0.9",
            "192.88.99.1",
            "192.0.2.1",
            "198.18.1.1",
            "224.1.1.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:8.8.8.8",
            "fe80::1%en0",
            "fd00::1",
            "ff02::1",
            "64:ff9b::808:808",
            "2002:0808:0808::",
            "2001:db8::1",
            "3fff::1",
        ]:
            with self.subTest(ip=ip):
                self.assertFalse(cap.public_ip(ip))
        self.assertTrue(cap.public_ip(PUBLIC))
        self.assertTrue(cap.public_ip("2606:4700:4700::1111"))
        public = (socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC, 443))
        private = (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 443, 0, 0))
        with (
            patch.object(cap.socket, "getaddrinfo", return_value=[public, private]),
            self.assertRaisesRegex(cap.CaptureError, "non-public"),
        ):
            cap.resolve_public("images.example")
        with patch.object(cap.socket, "getaddrinfo", return_value=[public]):
            self.assertEqual(
                cap.resolve_public("images.example"), (socket.AF_INET, PUBLIC)
            )

    def test_plan_job_ids_and_offline_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            path.write_text(
                json.dumps(
                    {"schema": "odysee-image-migration-plan@1.0", "entries": [job()]}
                )
            )
            self.assertEqual(cap.load_plan(path), [job()])
            run = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    cap.__file__,
                    str(path),
                    "--allow-host",
                    HOSTS[0],
                ],
                capture_output=True,
                check=True,
            )
            self.assertEqual(json.loads(run.stdout)["network_requests"], 0)
            self.assertEqual(list(Path(directory).iterdir()), [path])
            bad = job()
            bad["job_id"] = "../escape"
            path.write_text(
                json.dumps(
                    {"schema": "odysee-image-migration-plan@1.0", "entries": [bad]}
                )
            )
            with self.assertRaises(cap.CaptureError):
                cap.load_plan(path)

    @unittest.skipUnless(sys.platform == "linux", "Capture CLI requires Linux")
    def test_capture_cli_records_rejected_job_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "plan.json"
            stage = root / "stage"
            source.write_text(
                json.dumps(
                    {"schema": "odysee-image-migration-plan@1.0", "entries": [job()]}
                )
            )
            command = [
                sys.executable,
                "-I",
                "-B",
                cap.__file__,
                str(source),
                "--capture",
                "--allow-host",
                "other.example",
                "--output",
                str(stage),
            ]
            run = subprocess.run(command, capture_output=True, check=False)
            self.assertEqual(run.returncode, 2, run.stderr.decode())
            self.assertEqual(json.loads(run.stdout)["rejected"], 1)
            self.assertEqual(
                json.loads((stage / "checkpoint.json").read_bytes())["jobs"][
                    job()["job_id"]
                ]["reason"],
                "host-not-approved",
            )
            resumed = subprocess.run(command, capture_output=True, check=False)
            self.assertEqual(json.loads(resumed.stdout)["attempted"], 0)

    @unittest.skipUnless(
        shutil.which("node"), "Node inventory interoperability runs in the host suite"
    )
    def test_existing_javascript_inventory_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            source, plan = (
                Path(directory) / "claims.json",
                Path(directory) / "plan.json",
            )
            source.write_text(
                json.dumps(
                    [
                        {
                            "legacy_outpoint": "a" * 64 + ":0",
                            "claim_type": "stream",
                            "thumbnail_url": job()["source_url"],
                        }
                    ]
                )
            )
            run = subprocess.run(
                [
                    "node",
                    "--experimental-strip-types",
                    str(Path(cap.__file__).with_name("plan-legacy-images.mjs")),
                    str(source),
                ],
                capture_output=True,
                check=True,
            )
            plan.write_bytes(run.stdout)
            self.assertEqual(cap.load_plan(plan), [job()])


class DecodeTests(unittest.TestCase):
    def test_real_supported_decoders_and_exact_bytes(self):
        for format, mime in cap.MIME.items():
            data = image_bytes(format)
            original = data[:]
            self.assertEqual(
                cap.decode_image(data, mime),
                {"width": 4, "height": 3, "frames": 1, "content_type": mime},
            )
            self.assertEqual(data, original)

    def test_corruption_mime_and_resource_budgets(self):
        for data, mime in [
            (b"<svg/>", "image/png"),
            (b"\x89PNG\r\n\x1a\n", "image/png"),
            (image_bytes()[:40], "image/png"),
            (image_bytes(), "image/jpeg"),
        ]:
            with self.assertRaises(cap.CaptureError):
                cap.decode_image(data, mime)
        with (
            patch.object(cap, "MAX_DIMENSION", 2),
            self.assertRaisesRegex(cap.CaptureError, "budget"),
        ):
            cap.decode_image(image_bytes(), "image/png")
        frames = [Image.new("RGB", (4, 3), color) for color in ("red", "blue", "green")]
        stream = io.BytesIO()
        frames[0].save(stream, format="GIF", append_images=frames[1:], save_all=True)
        self.assertEqual(cap.decode_image(stream.getvalue(), "image/gif")["frames"], 3)
        with (
            patch.object(cap, "MAX_FRAMES", 2),
            self.assertRaisesRegex(cap.CaptureError, "budget"),
        ):
            cap.decode_image(stream.getvalue(), "image/gif")
        with (
            patch.object(cap, "MAX_FRAME_PIXELS", 20),
            self.assertRaisesRegex(cap.CaptureError, "budget"),
        ):
            cap.decode_image(stream.getvalue(), "image/gif")

    @unittest.skipUnless(
        sys.platform == "linux",
        "Hard worker memory limits require Linux; run the container suite",
    )
    def test_worker_real_resource_limits_and_decoder(self):
        code = """
import sys, json, base64
sys.path.insert(0, sys.argv[1])
import capture_legacy_images as c
data = base64.b64decode(sys.argv[2])
c.download = lambda *_: (data, 'image/png', ['https://images.example/a.png'])
print(json.dumps(c.worker({'source_url': 'https://images.example/a.png', 'hosts': ['images.example']})))
"""
        run = subprocess.run(
            [
                sys.executable,
                "-I",
                "-B",
                "-c",
                code,
                str(Path(cap.__file__).parent),
                base64.b64encode(image_bytes()).decode(),
            ],
            capture_output=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(run.returncode, 0, run.stderr.decode())
        self.assertEqual(json.loads(run.stdout)["sha256"], cap.digest(image_bytes()))
        with patch.object(
            cap.subprocess, "run", side_effect=subprocess.TimeoutExpired("worker", 30)
        ):
            self.assertEqual(
                cap.run_worker(job()["source_url"], HOSTS)["reason"], "job-deadline"
            )
        with patch.object(cap.subprocess, "run", return_value=Mock(returncode=-9)):
            self.assertEqual(
                cap.run_worker(job()["source_url"], HOSTS)["status"], "failed"
            )


class StagingTests(unittest.TestCase):
    def test_resume_dedup_limits_and_integrity(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(cap, "run_worker", side_effect=lambda *_: result()) as fetch,
        ):
            entries = [job(), job("b.png", "avatar")]
            self.assertEqual(
                cap.capture(entries, directory, HOSTS, limit=1)["pending"], 1
            )
            self.assertEqual(cap.capture(entries, directory, HOSTS)["captured"], 2)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(cap.capture(entries, directory, HOSTS)["attempted"], 0)
            self.assertEqual(len(list((Path(directory) / "blobs").iterdir())), 1)
            state = json.loads((Path(directory) / "checkpoint.json").read_text())
            self.assertFalse(
                state["jobs"][entries[0]["job_id"]]["historical_bytes_verified"]
            )
            self.assertFalse(state["jobs"][entries[0]["job_id"]]["published"])
            self.assertNotIn("body", state["jobs"][entries[0]["job_id"]])
            (Path(directory) / "blobs" / cap.digest(image_bytes())).write_bytes(
                b"corrupt"
            )
            with self.assertRaisesRegex(cap.CaptureError, "corrupt"):
                cap.capture(entries, directory, HOSTS)
            self.assertEqual(fetch.call_count, 2)

    def test_failed_missing_retry_and_rejected_redaction(self):
        with tempfile.TemporaryDirectory() as directory:
            entries = [job(), job("gone.png"), job("secret.png?token=do-not-copy")]
            responses = [
                {"status": "failed", "reason": "http-503"},
                {"status": "missing", "reason": "http-404"},
            ]
            with patch.object(cap, "run_worker", side_effect=responses):
                summary = cap.capture(entries, directory, HOSTS)
            self.assertEqual(
                [summary[k] for k in ("failed", "missing", "rejected")], [1, 1, 1]
            )
            self.assertNotIn(
                "do-not-copy", (Path(directory) / "checkpoint.json").read_text()
            )
            with patch.object(
                cap, "run_worker", side_effect=lambda *_: result()
            ) as fetch:
                self.assertEqual(cap.capture(entries, directory, HOSTS)["attempted"], 0)
                self.assertEqual(
                    cap.capture(entries, directory, HOSTS, retry_failed=True)[
                        "captured"
                    ],
                    2,
                )
                self.assertEqual(fetch.call_count, 2)

    def test_plan_policy_lock_and_symlink_protection(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(cap, "run_worker", side_effect=lambda *_: result()),
        ):
            cap.capture([job()], directory, HOSTS)
            with self.assertRaisesRegex(cap.CaptureError, "mismatch"):
                cap.capture([job("changed.png")], directory, HOSTS)
            with self.assertRaisesRegex(cap.CaptureError, "mismatch"):
                cap.capture([job()], directory, [HOSTS[0]])
            with (
                cap.stage_lock(Path(directory)),
                self.assertRaisesRegex(cap.CaptureError, "in-use"),
            ):
                cap.capture([job()], directory, HOSTS)
            blob = Path(directory) / "blobs" / cap.digest(image_bytes())
            blob.unlink()
            blob.symlink_to(Path(directory) / "checkpoint.json")
            with self.assertRaisesRegex(cap.CaptureError, "unsafe-staging"):
                cap.capture([job()], directory, HOSTS)

    def test_interrupted_checkpoint_retains_previous_and_can_resume(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(cap, "run_worker", side_effect=lambda *_: result()),
        ):
            entries = [job(), job("b.png")]
            cap.capture(entries, directory, HOSTS, limit=1)
            checkpoint = Path(directory) / "checkpoint.json"
            original = checkpoint.read_bytes()
            with (
                patch.object(
                    cap.os, "replace", side_effect=OSError("simulated disk error")
                ),
                self.assertRaises(OSError),
            ):
                cap.capture(entries, directory, HOSTS)
            self.assertEqual(checkpoint.read_bytes(), original)
            self.assertEqual(cap.capture(entries, directory, HOSTS)["captured"], 2)

    def test_output_refuses_unrelated_files_and_unsafe_blob_names(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "unrelated.txt").write_text("keep")
            with self.assertRaisesRegex(cap.CaptureError, "dedicated"):
                cap.capture([job()], directory, HOSTS)
            self.assertEqual((Path(directory) / "unrelated.txt").read_text(), "keep")
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(cap, "run_worker", side_effect=lambda *_: result()),
        ):
            cap.capture([job()], directory, HOSTS)
            path = Path(directory) / "checkpoint.json"
            state = json.loads(path.read_bytes())
            state["jobs"][job()["job_id"]]["sha256"] = "../escape"
            path.write_text(json.dumps(state))
            with self.assertRaisesRegex(cap.CaptureError, "invalid-blob"):
                cap.capture([job()], directory, HOSTS)

    def test_blob_survives_crash_before_receipt_and_resumes_idempotently(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(cap, "run_worker", side_effect=lambda *_: result()),
        ):
            real_write = cap.atomic_write

            def interrupted(path, data):
                if path.name == "checkpoint.json":
                    raise OSError("simulated interruption")
                real_write(path, data)

            with (
                patch.object(cap, "atomic_write", side_effect=interrupted),
                self.assertRaises(OSError),
            ):
                cap.capture([job()], directory, HOSTS)
            blob = Path(directory) / "blobs" / cap.digest(image_bytes())
            self.assertEqual(blob.read_bytes(), image_bytes())
            self.assertEqual(cap.capture([job()], directory, HOSTS)["captured"], 1)
            self.assertEqual(len(list(blob.parent.iterdir())), 1)


class TLSTests(unittest.TestCase):
    """Real HTTP/TLS, with test-only socket routing to an ephemeral local server.

    Production has no local-host exemption or insecure-TLS flag. Policy/pinning
    remain exercised; only the test TCP endpoint and trust root are substituted.
    """

    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        root = Path(cls.directory.name)
        cls.cert, cls.key = root / "cert.pem", root / "key.pem"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=images.example",
                "-addext",
                "subjectAltName=DNS:images.example",
                "-keyout",
                str(cls.key),
                "-out",
                str(cls.cert),
            ],
            check=True,
            capture_output=True,
        )
        cls.requests = []
        data = image_bytes()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                cls.requests.append((self.path, dict(self.headers)))
                routes = {
                    "/redirect": (302, {"Location": "/image"}, b""),
                    "/private": (302, {"Location": "https://other.example/image"}, b""),
                    "/secret": (302, {"Location": "/image?token=secret"}, b""),
                    "/loop": (302, {"Location": "/loop"}, b""),
                    "/missing": (404, {}, b"not found"),
                    "/busy": (503, {}, b"error"),
                    "/gzip": (200, {"Content-Encoding": "gzip"}, data),
                    "/html": (200, {"Content-Type": "text/html"}, b"<html/>"),
                    "/large": (200, {"Content-Length": str(cap.MAX_BYTES + 1)}, b""),
                    "/stream-large": (200, {}, b"x" * 129),
                }
                status, headers, body = routes.get(self.path, (200, {}, data))
                self.send_response(status)
                self.send_header(
                    "Content-Type", headers.pop("Content-Type", "image/png")
                )
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cls.cert, cls.key)
        cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.directory.cleanup()

    def setUp(self):
        port = self.server.server_address[1]
        real_socket = socket.socket

        class FixtureSocket(real_socket):
            def connect(self, address):
                if address == (PUBLIC, 443):
                    return super().connect(("127.0.0.1", port))
                raise AssertionError("unexpected test connection")

            def getpeername(self):
                return PUBLIC, 443

        def resolve(host, *_args, **_kwargs):
            return [
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    6,
                    "",
                    (PUBLIC if host == HOSTS[0] else "127.0.0.1", 443),
                )
            ]

        trust = ssl.create_default_context(cafile=str(self.cert))
        self.requests.clear()
        for patcher in [
            patch.object(cap.socket, "socket", FixtureSocket),
            patch.object(cap.socket, "getaddrinfo", side_effect=resolve),
            patch.object(cap.ssl, "create_default_context", return_value=trust),
        ]:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_real_download_decode_redirect_and_no_credentials(self):
        data, mime, chain = cap.download("https://images.example/redirect", HOSTS)
        self.assertEqual(data, image_bytes())
        self.assertEqual(cap.decode_image(data, mime)["width"], 4)
        self.assertEqual(
            chain, ["https://images.example/redirect", "https://images.example/image"]
        )
        self.assertEqual(len(self.requests), 2)
        for _, headers in self.requests:
            self.assertEqual(headers["Host"], "images.example")
            self.assertNotIn("Cookie", headers)
            self.assertNotIn("Authorization", headers)

    def test_real_tls_bytes_stage_and_resume_without_refetch(self):
        def fetch(source, hosts):
            data, mime, chain = cap.download(source, hosts)
            receipt = result(data)
            receipt.update(cap.decode_image(data, mime), redirect_chain=chain)
            return receipt

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(cap, "run_worker", side_effect=fetch),
        ):
            entries = [job("redirect")]
            self.assertEqual(cap.capture(entries, directory, HOSTS)["captured"], 1)
            state = json.loads((Path(directory) / "checkpoint.json").read_bytes())
            receipt = state["jobs"][entries[0]["job_id"]]
            self.assertEqual(
                receipt["redirect_chain"][-1], "https://images.example/image"
            )
            self.assertEqual(
                (Path(directory) / "blobs" / receipt["sha256"]).read_bytes(),
                image_bytes(),
            )
            self.assertEqual(cap.capture(entries, directory, HOSTS)["attempted"], 0)
            self.assertEqual(len(self.requests), 2)

    def test_redirect_dns_revalidation_and_no_second_connection(self):
        with self.assertRaisesRegex(cap.CaptureError, "non-public"):
            cap.download("https://images.example/private", HOSTS)
        self.assertEqual(len(self.requests), 1)
        for route in ("secret", "loop"):
            with self.assertRaises(cap.CaptureError):
                cap.download(f"https://images.example/{route}", HOSTS)

    def test_http_failures_types_and_stream_limits(self):
        for route, status in [
            ("missing", "missing"),
            ("busy", "failed"),
            ("gzip", "rejected"),
            ("html", "rejected"),
            ("large", "rejected"),
        ]:
            with (
                self.subTest(route=route),
                self.assertRaises(cap.CaptureError) as caught,
            ):
                cap.download(f"https://images.example/{route}", HOSTS)
            self.assertEqual(caught.exception.status, status)
        with (
            patch.object(cap, "MAX_BYTES", 128),
            self.assertRaisesRegex(cap.CaptureError, "too-large"),
        ):
            cap.download("https://images.example/stream-large", HOSTS)

    def test_tls_hostname_authentication_is_not_disabled(self):
        with (
            patch.object(cap, "resolve_public", return_value=(socket.AF_INET, PUBLIC)),
            self.assertRaises(ssl.SSLCertVerificationError),
        ):
            cap.download("https://other.example/image", HOSTS)


if __name__ == "__main__":
    unittest.main()
