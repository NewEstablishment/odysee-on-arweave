import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.HYPERSTREAM_SERVER_NO_LISTEN = "1";
process.env.HYPERSTREAM_MEDIA_TOKEN_SECRET = "hyperstream-server-security-test-secret";

const {
  closeServer,
  createMediaId,
  discoverMediaResources,
  mediaPath,
  releaseToken,
  segmentLocator,
  server,
  trackerToken,
  validMediaId,
  validReleaseToken,
  validSegmentPath,
  validTrackerToken,
  withAllocationLock,
} = await import("./server.mjs");

after(async () => {
  await closeServer();
});

test("test imports do not bind the application server", () => {
  assert.equal(server.listening, false);
});

test("media identifiers are authenticated and media paths are exact", () => {
  const mediaId = createMediaId();
  const otherMediaId = createMediaId();
  const [prefix, nonce, mac] = mediaId.split("-");
  const tamperedNonce = `${nonce[0] === "A" ? "B" : "A"}${nonce.slice(1)}`;
  const tamperedMac = `${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`;

  assert.equal(prefix, "hs");
  assert.equal(validMediaId(mediaId), true);
  assert.equal(validMediaId(otherMediaId), true);
  assert.equal(validMediaId(`hs-${tamperedNonce}-${mac}`), false);
  assert.equal(validMediaId(`hs-${nonce}-${tamperedMac}`), false);
  assert.equal(validMediaId(`${mediaId}-suffix`), false);
  assert.equal(mediaPath(mediaId), mediaId);
  assert.equal(mediaPath(`/${mediaId}`), mediaId);
  assert.equal(mediaPath(`${mediaId}/variant`), null);
  assert.equal(mediaPath(`/${mediaId}/whip`), null);
  assert.equal(mediaPath(`//${mediaId}`), null);
  assert.equal(mediaPath(otherMediaId), otherMediaId);
});

test("release credentials are scoped to one authenticated media identifier", () => {
  const mediaId = createMediaId();
  const otherMediaId = createMediaId();
  const token = releaseToken(mediaId);
  const tampered = `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`;

  assert.equal(validReleaseToken(mediaId, token), true);
  assert.equal(validReleaseToken(otherMediaId, token), false);
  assert.equal(validReleaseToken(mediaId, tampered), false);
  assert.equal(validReleaseToken(mediaId, ""), false);
});

test("tracker capabilities are media-scoped, authenticated, and expiring", () => {
  const mediaId = createMediaId();
  const otherMediaId = createMediaId();
  const now = 2_000_000_000;
  const expiresAt = now + 60;
  const token = trackerToken(mediaId, expiresAt);

  assert.equal(validTrackerToken(mediaId, expiresAt, token, now), true);
  assert.equal(validTrackerToken(mediaId, expiresAt, token, expiresAt), true);
  assert.equal(validTrackerToken(mediaId, expiresAt, token, expiresAt + 1), false);
  assert.equal(validTrackerToken(otherMediaId, expiresAt, token, now), false);
  assert.equal(validTrackerToken(mediaId, expiresAt + 1, token, now), false);
  assert.equal(validTrackerToken(mediaId, expiresAt, `${token}x`, now), false);
  assert.equal(validTrackerToken("hs-invalid", expiresAt, trackerToken("hs-invalid", expiresAt), now), false);
});

test("segment locators accept only exact MediaMTX fMP4 names and query fields", () => {
  const mediaId = createMediaId();
  const sessionId = "01234567-89ab-cdef-0123-456789abcdef";
  const segment = "19af5749a15e_video1_seg105.mp4";
  const init = "19af5749a15e_audio2_init.mp4";
  const url = (query) => new URL(`https://demo.test/digest?${query}`);

  assert.equal(validSegmentPath(segment), true);
  assert.equal(validSegmentPath(init), true);
  assert.deepEqual(
    segmentLocator(mediaId, url(`segment=${segment}&session=${sessionId}`), true),
    { segment, sessionId },
  );
  assert.equal(segmentLocator(mediaId, url(`segment=${segment}&session=${sessionId}`), false), null);
  assert.equal(segmentLocator(`${mediaId}x`, url(`segment=${segment}&session=${sessionId}`), true), null);
  assert.equal(
    segmentLocator(mediaId, url(`segment=${segment}&segment=${segment}&session=${sessionId}`), true),
    null,
  );
  assert.equal(
    segmentLocator(mediaId, url(`segment=${segment}&session=${sessionId}&session=${sessionId}`), true),
    null,
  );
  assert.equal(segmentLocator(mediaId, url(`segment=${segment}&session=${sessionId}&start=0`), true), null);
  assert.equal(segmentLocator(mediaId, url(`segment=${segment}&session=${sessionId}&extra=1`), true), null);
  assert.equal(segmentLocator(mediaId, url(`segment=undefined&session=${sessionId}`), true), null);
  assert.equal(segmentLocator(mediaId, url(`segment=ABCDEF123456_video1_seg1.mp4&session=${sessionId}`), true), null);
  assert.equal(segmentLocator(mediaId, url(`segment=19af5749a15e/video1_seg1.mp4&session=${sessionId}`), true), null);
  assert.equal(segmentLocator(mediaId, url(`segment=${segment}&session=short`), true), null);
});

test("allocation lock serializes work and remains usable after rejection", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = withAllocationLock(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return "first";
  });
  const second = withAllocationLock(async () => {
    events.push("second:start");
    return "second";
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);

  await assert.rejects(
    withAllocationLock(async () => {
      throw new Error("allocation-failed");
    }),
    /allocation-failed/,
  );
  assert.equal(await withAllocationLock(async () => "recovered"), "recovered");
});

test("media discovery ignores disabled protocol collections but not API failures", async () => {
  const mediaId = createMediaId();
  const resourceId = "01234567-89ab-cdef-0123-456789abcdef";
  const resources = await discoverMediaResources(mediaId, async (pathname) => {
    if (pathname.includes("rtmpconns")) {
      throw Object.assign(new Error("not-found"), { status: 404 });
    }
    return {
      items: [
        { id: resourceId, path: mediaId },
        { id: "fedcba98-7654-3210-fedc-ba9876543210", path: createMediaId() },
      ],
    };
  });
  assert.deepEqual([...resources.values()], [{ kind: "webrtcsessions", id: resourceId }]);

  await assert.rejects(
    discoverMediaResources(mediaId, async () => {
      throw Object.assign(new Error("unavailable"), { status: 503 });
    }),
    /unavailable/,
  );
});
