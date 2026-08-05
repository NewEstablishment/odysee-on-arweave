import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { WebTorrentTracker } from "./webtorrent-tracker.mjs";

function opened(websocket) {
  return new Promise((resolve, reject) => {
    websocket.once("open", resolve);
    websocket.once("error", reject);
  });
}

function closed(websocket) {
  return new Promise((resolve) => websocket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") })));
}

function message(websocket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      websocket.off("message", onMessage);
      reject(new Error("tracker-message-timeout"));
    }, 2_000);
    function onMessage(data) {
      const value = JSON.parse(data.toString("utf8"));
      if (!predicate(value)) {
        return;
      }
      clearTimeout(timeout);
      websocket.off("message", onMessage);
      resolve(value);
    }
    websocket.on("message", onMessage);
  });
}

async function createTrackerServer(context, options, upgradeContext) {
  const tracker = new WebTorrentTracker(options);
  const server = createServer();
  server.on("upgrade", (request, socket, head) => {
    const resolvedContext = typeof upgradeContext === "function" ? upgradeContext(request) : upgradeContext;
    tracker.handleUpgrade(request, socket, head, resolvedContext);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => {
    tracker.close();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return { tracker, url: `ws://127.0.0.1:${address.port}/tracker` };
}

function fixedId(prefix, index) {
  return `${prefix}${String(index).padStart(20 - prefix.length, "0")}`;
}

async function exchange(websocket, payload, predicate = () => true) {
  const response = message(websocket, predicate);
  websocket.send(JSON.stringify(payload));
  return response;
}

test("routes WebTorrent offers and answers within one swarm", async (context) => {
  const tracker = new WebTorrentTracker({ intervalSeconds: 120, maxConnections: 8, maxPeersPerSwarm: 8 });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => tracker.handleUpgrade(request, socket, head));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => {
    tracker.close();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/tracker`;
  const infoHash = "hyperstream-swarm-01";
  const receiverId = "-PM0300-receiver0001";
  const senderId = "-PM0300-sender000001";
  const offerId = "offer-00000000000000";
  assert.equal(infoHash.length, 20);
  assert.equal(receiverId.length, 20);
  assert.equal(senderId.length, 20);
  assert.equal(offerId.length, 20);

  const receiver = new WebSocket(url);
  await opened(receiver);
  const receiverReady = message(receiver, (value) => value.interval === 120);
  receiver.send(JSON.stringify({
    action: "announce",
    downloaded: 0,
    event: "started",
    info_hash: infoHash,
    offers: [],
    peer_id: receiverId,
    uploaded: 0,
  }));
  await receiverReady;

  const sender = new WebSocket(url);
  await opened(sender);
  const senderReady = message(sender, (value) => value.interval === 120);
  const incomingOffer = message(receiver, (value) => value.offer_id === offerId);
  sender.send(JSON.stringify({
    action: "announce",
    downloaded: 0,
    event: "started",
    info_hash: infoHash,
    offers: [{ offer: { type: "offer", sdp: "offer-sdp" }, offer_id: offerId }],
    peer_id: senderId,
    uploaded: 0,
  }));
  assert.equal((await senderReady).incomplete, 2);
  assert.deepEqual(await incomingOffer, {
    action: "announce",
    info_hash: infoHash,
    offer: { type: "offer", sdp: "offer-sdp" },
    offer_id: offerId,
    peer_id: senderId,
  });

  const incomingAnswer = message(sender, (value) => value.answer !== undefined);
  receiver.send(JSON.stringify({
    action: "announce",
    answer: { type: "answer", sdp: "answer-sdp" },
    info_hash: infoHash,
    offer_id: offerId,
    peer_id: receiverId,
    to_peer_id: senderId,
  }));
  assert.deepEqual(await incomingAnswer, {
    action: "announce",
    answer: { type: "answer", sdp: "answer-sdp" },
    info_hash: infoHash,
    offer_id: offerId,
    peer_id: receiverId,
  });

  const receiverClosed = closed(receiver);
  const senderClosed = closed(sender);
  receiver.close();
  sender.close();
  await Promise.all([receiverClosed, senderClosed]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});

test("closes connections that exceed the announce rate", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    maxAnnouncesPerMinute: 2,
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  const infoHash = fixedId("rate-", 1);
  const peerId = fixedId("-PMRATE-", 1);
  const announce = {
    action: "announce",
    info_hash: infoHash,
    offers: [],
    peer_id: peerId,
  };

  assert.equal((await exchange(websocket, { ...announce, event: "started" }, (value) => value.interval === 120)).incomplete, 1);
  assert.equal((await exchange(websocket, { ...announce, event: "update" }, (value) => value.interval === 120)).incomplete, 1);

  const rateFailure = message(websocket, (value) => value["failure reason"] === "announce-rate-limit");
  const rateClosed = closed(websocket);
  websocket.send(JSON.stringify({ ...announce, event: "update" }));
  assert.equal((await rateFailure)["failure reason"], "announce-rate-limit");
  assert.deepEqual(await rateClosed, { code: 1008, reason: "announce-rate-limit" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});

test("terminates a connection before exceeding its outbound buffer budget", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    maxBufferedBytes: 64,
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  const websocketClosed = closed(websocket);
  websocket.send(JSON.stringify({
    action: "announce",
    event: "started",
    info_hash: fixedId("buffer-", 1),
    offers: [],
    peer_id: fixedId("-PMBUFFER-", 1),
  }));
  assert.deepEqual(await websocketClosed, { code: 1006, reason: "" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});

test("connection swarm rejections do not consume tracker swarm capacity", async (context) => {
  const { url } = await createTrackerServer(context, {
    maxConnections: 8,
    maxPeersPerSwarm: 8,
    maxSwarms: 8,
    maxSwarmsPerConnection: 1,
  });
  const first = new WebSocket(url);
  await opened(first);
  const firstPeerId = fixedId("-PMCAP-A-", 1);
  const firstHash = fixedId("capacity-", 0);
  await exchange(first, {
    action: "announce",
    event: "started",
    info_hash: firstHash,
    offers: [],
    peer_id: firstPeerId,
  }, (value) => value.interval === 120);

  for (let index = 1; index <= 7; index += 1) {
    const infoHash = fixedId("capacity-", index);
    const rejected = await exchange(first, {
      action: "announce",
      event: "started",
      info_hash: infoHash,
      offers: [],
      peer_id: firstPeerId,
    }, (value) => value.info_hash === infoHash);
    assert.equal(rejected["failure reason"], "connection-swarm-capacity");
  }

  const second = new WebSocket(url);
  await opened(second);
  const admitted = await exchange(second, {
    action: "announce",
    event: "started",
    info_hash: fixedId("capacity-", 8),
    offers: [],
    peer_id: fixedId("-PMCAP-B-", 1),
  }, (value) => value.interval === 120 || value["failure reason"] !== undefined);
  assert.equal(admitted["failure reason"], undefined);
  assert.equal(admitted.interval, 120);

  const firstClosed = closed(first);
  const secondClosed = closed(second);
  first.close();
  second.close();
  await Promise.all([firstClosed, secondClosed]);
});

test("invalid offers do not consume tracker swarm capacity", async (context) => {
  const { url } = await createTrackerServer(context, {
    maxConnections: 8,
    maxPeersPerSwarm: 8,
    maxSwarms: 8,
    maxSwarmsPerConnection: 16,
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  const peerId = fixedId("-PMBAD-", 1);

  for (let index = 0; index < 8; index += 1) {
    const infoHash = fixedId("invalid-", index);
    const rejected = await exchange(websocket, {
      action: "announce",
      event: "started",
      info_hash: infoHash,
      offers: [{}],
      peer_id: peerId,
    }, (value) => value.info_hash === infoHash);
    assert.equal(rejected["failure reason"], "invalid-offer");
  }

  const admitted = await exchange(websocket, {
    action: "announce",
    event: "started",
    info_hash: fixedId("invalid-", 8),
    offers: [],
    peer_id: peerId,
  }, (value) => value.interval === 120 || value["failure reason"] !== undefined);
  assert.equal(admitted["failure reason"], undefined);
  assert.equal(admitted.interval, 120);

  const websocketClosed = closed(websocket);
  websocket.close();
  await websocketClosed;
});

test("restricts announces to the info hashes allowed by the upgrade context", async (context) => {
  const allowedHash = fixedId("allowed-", 1);
  const deniedHash = fixedId("denied-", 1);
  const { url } = await createTrackerServer(context, {
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  }, {
    allowedInfoHashes: [allowedHash],
    clientKey: "viewer-1",
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  const peerId = fixedId("-PMSCOPE-", 1);

  const denied = await exchange(websocket, {
    action: "announce",
    event: "started",
    info_hash: deniedHash,
    offers: [],
    peer_id: peerId,
  }, (value) => value.info_hash === deniedHash);
  assert.equal(denied["failure reason"], "info-hash-not-allowed");

  const admitted = await exchange(websocket, {
    action: "announce",
    event: "started",
    info_hash: allowedHash,
    offers: [],
    peer_id: peerId,
  }, (value) => value.info_hash === allowedHash);
  assert.equal(admitted["failure reason"], undefined);
  assert.equal(admitted.incomplete, 1);

  const websocketClosed = closed(websocket);
  websocket.close();
  await websocketClosed;
});

test("caps and releases connections for each upgrade client key", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    maxConnections: 8,
    maxConnectionsPerClient: 1,
    maxPeersPerSwarm: 8,
  }, {
    clientKey: "shared-client",
  });
  const first = new WebSocket(url);
  await opened(first);
  assert.equal(tracker.connectionCount, 1);

  const rejected = new WebSocket(url);
  const rejection = await new Promise((resolve) => {
    rejected.once("open", () => resolve("opened"));
    rejected.once("error", () => resolve("rejected"));
  });
  assert.equal(rejection, "rejected");
  assert.equal(tracker.connectionCount, 1);

  const firstClosed = closed(first);
  first.close();
  await firstClosed;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);

  const replacement = new WebSocket(url);
  await opened(replacement);
  assert.equal(tracker.connectionCount, 1);
  const replacementClosed = closed(replacement);
  replacement.close();
  await replacementClosed;
});

test("closes connections that miss the first announce deadline", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    firstAnnounceTimeoutMs: 40,
    idleAnnounceTimeoutMs: 1_000,
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  const timeoutFailure = message(websocket, (value) => value["failure reason"] === "first-announce-timeout");
  const timeoutClosed = closed(websocket);
  assert.equal((await timeoutFailure)["failure reason"], "first-announce-timeout");
  assert.deepEqual(await timeoutClosed, { code: 1008, reason: "first-announce-timeout" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});

test("closes announced connections after the idle announce deadline", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    firstAnnounceTimeoutMs: 1_000,
    idleAnnounceTimeoutMs: 40,
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  await exchange(websocket, {
    action: "announce",
    event: "started",
    info_hash: fixedId("idle-", 1),
    offers: [],
    peer_id: fixedId("-PMIDLE-", 1),
  }, (value) => value.interval === 120);

  const timeoutFailure = message(websocket, (value) => value["failure reason"] === "announce-idle-timeout");
  const timeoutClosed = closed(websocket);
  assert.equal((await timeoutFailure)["failure reason"], "announce-idle-timeout");
  assert.deepEqual(await timeoutClosed, { code: 1008, reason: "announce-idle-timeout" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});

test("closes a connection when its upgrade capability expires", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    firstAnnounceTimeoutMs: 1_000,
    idleAnnounceTimeoutMs: 1_000,
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  }, {
    expiresAt: Date.now() + 60,
    scope: "media-expiring",
  });
  const websocket = new WebSocket(url);
  await opened(websocket);
  const expired = message(websocket, (value) => value["failure reason"] === "tracker-capability-expired");
  const websocketClosed = closed(websocket);
  assert.equal((await expired)["failure reason"], "tracker-capability-expired");
  assert.deepEqual(await websocketClosed, { code: 1008, reason: "tracker-capability-expired" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});

test("revokes every connection in one capability scope", async (context) => {
  const { tracker, url } = await createTrackerServer(context, {
    maxConnections: 8,
    maxPeersPerSwarm: 8,
  }, {
    expiresAt: Date.now() + 10_000,
    scope: "media-revoked",
  });
  const first = new WebSocket(url);
  const second = new WebSocket(url);
  await Promise.all([opened(first), opened(second)]);
  const firstRevoked = message(first, (value) => value["failure reason"] === "tracker-capability-revoked");
  const secondRevoked = message(second, (value) => value["failure reason"] === "tracker-capability-revoked");
  const firstClosed = closed(first);
  const secondClosed = closed(second);
  assert.equal(tracker.revoke("media-revoked"), 2);
  assert.equal((await firstRevoked)["failure reason"], "tracker-capability-revoked");
  assert.equal((await secondRevoked)["failure reason"], "tracker-capability-revoked");
  assert.deepEqual(await firstClosed, { code: 1008, reason: "tracker-capability-revoked" });
  assert.deepEqual(await secondClosed, { code: 1008, reason: "tracker-capability-revoked" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracker.connectionCount, 0);
});
