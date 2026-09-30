# Build using ONLY scripts/ as context, never the repository/private node store.
FROM python:3.14.6-slim-bookworm@sha256:4c92ffcde4dd6f1ff72a24518f49fd4990b27134987dfa31a733badde66df9f8 AS runtime
WORKDIR /app
COPY legacy-image-requirements.txt ./
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r legacy-image-requirements.txt
COPY capture_legacy_images.py ./
USER 65532:65532
ENTRYPOINT ["python", "-I", "-B", "/app/capture_legacy_images.py"]

FROM runtime AS test
COPY test_capture_legacy_images.py ./
ENTRYPOINT ["python", "-B", "-m", "unittest", "discover", "-s", "/app", "-p", "test_capture_legacy_images.py", "-v"]
