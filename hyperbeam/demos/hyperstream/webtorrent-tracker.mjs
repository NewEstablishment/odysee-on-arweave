import { WebSocket, WebSocketServer } from "ws";

const ID_LENGTH = 20;
const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_OFFERS = 16;
const MAX_OFFER_ID_LENGTH = 128;
const MAX_SDP_LENGTH = 96 * 1024;
const RATE_WINDOW_MS = 60_000;

function boundedInteger(value, fallback, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function validId(value) {
  return typeof value === "string" && value.length === ID_LENGTH;
}

function validOfferId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_OFFER_ID_LENGTH;
}

function allowedInfoHashes(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const values = value instanceof Set || Array.isArray(value) ? value : [];
  return new Set(Array.from(values).filter(validId));
}

function clientKey(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function connectionScope(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

function validDescription(value, type) {
  const description = record(value);
  return description && description.type === type && typeof description.sdp === "string" && description.sdp.length <= MAX_SDP_LENGTH
    ? { type: description.type, sdp: description.sdp }
    : null;
}

function randomized(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export class WebTorrentTracker {
  #clientConnections = new Map();
  #connections = new Map();
  #firstAnnounceTimeoutMs;
  #heartbeat;
  #idleAnnounceTimeoutMs;
  #intervalSeconds;
  #maxAnnouncesPerMinute;
  #maxBufferedBytes;
  #maxConnections;
  #maxConnectionsPerClient;
  #maxPeersPerSwarm;
  #maxSwarms;
  #maxSwarmsPerConnection;
  #server;
  #swarms = new Map();

  constructor(options = {}) {
    this.#firstAnnounceTimeoutMs = boundedInteger(options.firstAnnounceTimeoutMs, 10_000, 25, 60_000);
    this.#idleAnnounceTimeoutMs = boundedInteger(options.idleAnnounceTimeoutMs, 180_000, 25, 3_600_000);
    this.#intervalSeconds = boundedInteger(options.intervalSeconds, 120, 20, 3_600);
    this.#maxAnnouncesPerMinute = boundedInteger(options.maxAnnouncesPerMinute, 240, 1, 3_600);
    this.#maxBufferedBytes = boundedInteger(options.maxBufferedBytes, 1024 * 1024, 64, 8 * 1024 * 1024);
    this.#maxConnections = boundedInteger(options.maxConnections, 2_048, 2, 20_000);
    this.#maxConnectionsPerClient = boundedInteger(options.maxConnectionsPerClient, 32, 1, 20_000);
    this.#maxPeersPerSwarm = boundedInteger(options.maxPeersPerSwarm, this.#maxConnections, 2, 20_000);
    this.#maxSwarmsPerConnection = boundedInteger(options.maxSwarmsPerConnection, 16, 1, 128);
    this.#maxSwarms = boundedInteger(options.maxSwarms, this.#maxConnections * 4, 8, 80_000);
    this.#server = new WebSocketServer({
      clientTracking: false,
      maxPayload: MAX_MESSAGE_BYTES,
      noServer: true,
      perMessageDeflate: false,
    });
    this.#server.on("connection", (websocket, request, context) => this.#accept(websocket, context));
    this.#heartbeat = setInterval(() => this.#pingConnections(), 30_000);
    this.#heartbeat.unref();
  }

  get connectionCount() {
    return this.#connections.size;
  }

  handleUpgrade(request, socket, head, context = {}) {
    const expiresAt = Number(context?.expiresAt);
    if (context?.expiresAt != null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) {
      socket.destroy();
      return false;
    }
    const connectionContext = {
      allowedInfoHashes: allowedInfoHashes(context?.allowedInfoHashes),
      clientKey: clientKey(context?.clientKey),
      expiresAt: context?.expiresAt == null ? null : expiresAt,
      scope: connectionScope(context?.scope),
    };
    if (!this.#canAccept(connectionContext.clientKey)) {
      socket.destroy();
      return false;
    }
    try {
      this.#server.handleUpgrade(request, socket, head, (websocket) => {
        if (!this.#canAccept(connectionContext.clientKey)) {
          websocket.close(1013, "tracker-capacity");
          return;
        }
        this.#server.emit("connection", websocket, request, connectionContext);
      });
      return true;
    } catch {
      socket.destroy();
      return false;
    }
  }

  close() {
    clearInterval(this.#heartbeat);
    for (const [websocket, metadata] of this.#connections) {
      clearTimeout(metadata.announceDeadline);
      clearTimeout(metadata.capabilityDeadline);
      websocket.terminate();
    }
    this.#connections.clear();
    this.#clientConnections.clear();
    this.#swarms.clear();
    this.#server.close();
  }

  revoke(scope) {
    const target = connectionScope(scope);
    if (!target) {
      return 0;
    }
    let revoked = 0;
    for (const [websocket, metadata] of this.#connections) {
      if (metadata.scope !== target) {
        continue;
      }
      revoked += 1;
      this.#failure(websocket, "tracker-capability-revoked");
      websocket.close(1008, "tracker-capability-revoked");
    }
    return revoked;
  }

  #accept(websocket, context) {
    const metadata = {
      alive: true,
      allowedInfoHashes: context.allowedInfoHashes,
      announces: [],
      announceDeadline: null,
      capabilityDeadline: null,
      clientKey: context.clientKey,
      peerId: null,
      scope: context.scope,
      swarms: new Set(),
    };
    this.#connections.set(websocket, metadata);
    if (metadata.clientKey) {
      this.#clientConnections.set(metadata.clientKey, (this.#clientConnections.get(metadata.clientKey) ?? 0) + 1);
    }
    this.#scheduleAnnounceDeadline(websocket, metadata, this.#firstAnnounceTimeoutMs, "first-announce-timeout");
    if (context.expiresAt) {
      metadata.capabilityDeadline = setTimeout(() => {
        if (!this.#connections.has(websocket)) {
          return;
        }
        this.#failure(websocket, "tracker-capability-expired");
        websocket.close(1008, "tracker-capability-expired");
      }, Math.max(1, context.expiresAt - Date.now()));
      metadata.capabilityDeadline.unref();
    }
    websocket.on("pong", () => {
      metadata.alive = true;
    });
    websocket.on("message", (data, isBinary) => this.#handleMessage(websocket, metadata, data, isBinary));
    websocket.once("close", () => this.#removeConnection(websocket, metadata));
    websocket.once("error", () => websocket.terminate());
  }

  #handleMessage(websocket, metadata, data, isBinary) {
    if (!this.#allowAnnounce(metadata)) {
      this.#failure(websocket, "announce-rate-limit");
      websocket.close(1008, "announce-rate-limit");
      return;
    }
    if (isBinary) {
      this.#failure(websocket, "text-messages-required");
      return;
    }
    let message;
    try {
      message = record(JSON.parse(data.toString("utf8")));
    } catch {
      this.#failure(websocket, "invalid-json");
      return;
    }
    if (!message || message.action !== "announce") {
      this.#failure(websocket, "announce-required");
      return;
    }
    const infoHash = message.info_hash;
    const peerId = message.peer_id;
    if (!validId(infoHash) || !validId(peerId)) {
      this.#failure(websocket, "invalid-identity");
      return;
    }
    if (metadata.allowedInfoHashes && !metadata.allowedInfoHashes.has(infoHash)) {
      this.#failure(websocket, "info-hash-not-allowed", infoHash);
      return;
    }
    if (metadata.peerId && metadata.peerId !== peerId) {
      this.#failure(websocket, "peer-id-changed", infoHash);
      return;
    }
    this.#scheduleAnnounceDeadline(websocket, metadata, this.#idleAnnounceTimeoutMs, "announce-idle-timeout");
    metadata.peerId = peerId;
    if (message.event === "stopped") {
      this.#leave(websocket, metadata, infoHash, peerId);
      return;
    }
    if (message.event && !["started", "completed", "paused", "update"].includes(message.event)) {
      this.#failure(websocket, "invalid-event", infoHash);
      return;
    }
    let offers;
    if (message.answer === undefined) {
      offers = this.#normalizeOffers(websocket, infoHash, message.offers);
      if (!offers) {
        return;
      }
    } else {
      const answer = validDescription(message.answer, "answer");
      if (!answer || !validId(message.to_peer_id) || !validOfferId(message.offer_id)) {
        this.#failure(websocket, "invalid-answer", infoHash);
        return;
      }
      const swarm = this.#swarms.get(infoHash);
      const peer = swarm?.get(peerId);
      if (!swarm || peer?.websocket !== websocket) {
        this.#failure(websocket, "answer-peer-unavailable", infoHash);
        return;
      }
      this.#forwardAnswer(websocket, swarm, infoHash, peerId, answer, message.to_peer_id, message.offer_id);
      return;
    }
    const swarm = this.#join(websocket, metadata, infoHash, peerId, message);
    if (!swarm) {
      return;
    }
    this.#forwardOffers(websocket, metadata, swarm, infoHash, peerId, offers);
  }

  #join(websocket, metadata, infoHash, peerId, message) {
    if (!metadata.swarms.has(infoHash) && metadata.swarms.size >= this.#maxSwarmsPerConnection) {
      this.#failure(websocket, "connection-swarm-capacity", infoHash);
      return null;
    }
    let swarm = this.#swarms.get(infoHash);
    if (!swarm) {
      if (this.#swarms.size >= this.#maxSwarms) {
        this.#failure(websocket, "tracker-swarm-capacity", infoHash);
        return null;
      }
      swarm = new Map();
    }
    const existing = swarm.get(peerId);
    if (existing && existing.websocket !== websocket && existing.websocket.readyState === WebSocket.OPEN) {
      this.#failure(websocket, "peer-id-already-active", infoHash);
      return null;
    }
    if (!existing && swarm.size >= this.#maxPeersPerSwarm) {
      this.#failure(websocket, "swarm-peer-capacity", infoHash);
      return null;
    }
    const complete = message.event === "completed" || message.left === 0 || existing?.complete === true;
    if (!this.#swarms.has(infoHash)) {
      this.#swarms.set(infoHash, swarm);
    }
    swarm.set(peerId, { complete, websocket });
    metadata.swarms.add(infoHash);
    return swarm;
  }

  #normalizeOffers(websocket, infoHash, value) {
    const offers = value === undefined ? [] : value;
    if (!Array.isArray(offers) || offers.length > MAX_OFFERS) {
      this.#failure(websocket, "invalid-offers", infoHash);
      return null;
    }
    const normalized = [];
    for (const item of offers) {
      const offer = record(item);
      const description = validDescription(offer?.offer, "offer");
      if (!description || !validOfferId(offer?.offer_id)) {
        this.#failure(websocket, "invalid-offer", infoHash);
        return null;
      }
      normalized.push({ offer: description, offerId: offer.offer_id });
    }
    return normalized;
  }

  #forwardOffers(websocket, metadata, swarm, infoHash, peerId, normalized) {
    let complete = 0;
    for (const peer of swarm.values()) {
      if (peer.complete) {
        complete += 1;
      }
    }
    if (!this.#send(websocket, {
      action: "announce",
      complete,
      incomplete: swarm.size - complete,
      info_hash: infoHash,
      interval: this.#intervalSeconds,
    })) {
      this.#leave(websocket, metadata, infoHash, peerId);
      return;
    }
    const candidates = randomized(
      Array.from(swarm.entries()).filter(
        ([candidateId, peer]) => candidateId !== peerId && peer.websocket.readyState === WebSocket.OPEN,
      ),
    );
    const count = Math.min(normalized.length, candidates.length);
    for (let index = 0; index < count; index += 1) {
      const [, target] = candidates[index];
      const offer = normalized[index];
      this.#send(target.websocket, {
        action: "announce",
        info_hash: infoHash,
        offer: offer.offer,
        offer_id: offer.offerId,
        peer_id: peerId,
      });
    }
  }

  #forwardAnswer(websocket, swarm, infoHash, peerId, answer, targetPeerId, offerId) {
    const target = swarm.get(targetPeerId);
    if (!target || target.websocket === websocket || target.websocket.readyState !== WebSocket.OPEN) {
      this.#failure(websocket, "answer-target-unavailable", infoHash);
      return;
    }
    this.#send(target.websocket, {
      action: "announce",
      answer,
      info_hash: infoHash,
      offer_id: offerId,
      peer_id: peerId,
    });
  }

  #leave(websocket, metadata, infoHash, peerId) {
    const swarm = this.#swarms.get(infoHash);
    const peer = swarm?.get(peerId);
    if (peer?.websocket === websocket) {
      swarm.delete(peerId);
      if (swarm.size === 0) {
        this.#swarms.delete(infoHash);
      }
    }
    metadata.swarms.delete(infoHash);
  }

  #removeConnection(websocket, metadata) {
    if (!this.#connections.delete(websocket)) {
      return;
    }
    clearTimeout(metadata.announceDeadline);
    clearTimeout(metadata.capabilityDeadline);
    if (metadata.clientKey) {
      const count = this.#clientConnections.get(metadata.clientKey) ?? 0;
      if (count <= 1) {
        this.#clientConnections.delete(metadata.clientKey);
      } else {
        this.#clientConnections.set(metadata.clientKey, count - 1);
      }
    }
    if (!metadata.peerId) {
      return;
    }
    for (const infoHash of metadata.swarms) {
      this.#leave(websocket, metadata, infoHash, metadata.peerId);
    }
  }

  #pingConnections() {
    for (const [websocket, metadata] of this.#connections) {
      if (!metadata.alive) {
        websocket.terminate();
        continue;
      }
      metadata.alive = false;
      try {
        websocket.ping();
      } catch {
        websocket.terminate();
      }
    }
  }

  #canAccept(key) {
    return this.#connections.size < this.#maxConnections
      && (!key || (this.#clientConnections.get(key) ?? 0) < this.#maxConnectionsPerClient);
  }

  #scheduleAnnounceDeadline(websocket, metadata, timeoutMs, reason) {
    clearTimeout(metadata.announceDeadline);
    metadata.announceDeadline = setTimeout(() => {
      if (!this.#connections.has(websocket)) {
        return;
      }
      this.#failure(websocket, reason);
      websocket.close(1008, reason);
    }, timeoutMs);
    metadata.announceDeadline.unref();
  }

  #allowAnnounce(metadata) {
    const now = Date.now();
    while (metadata.announces.length > 0 && metadata.announces[0] <= now - RATE_WINDOW_MS) {
      metadata.announces.shift();
    }
    if (metadata.announces.length >= this.#maxAnnouncesPerMinute) {
      return false;
    }
    metadata.announces.push(now);
    return true;
  }

  #failure(websocket, reason, infoHash) {
    this.#send(websocket, {
      action: "announce",
      "failure reason": reason,
      ...(validId(infoHash) ? { info_hash: infoHash } : {}),
    });
  }

  #send(websocket, message) {
    if (websocket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const payload = JSON.stringify(message);
    if (websocket.bufferedAmount + Buffer.byteLength(payload) > this.#maxBufferedBytes) {
      websocket.terminate();
      return false;
    }
    try {
      websocket.send(payload, (error) => {
        if (error) {
          websocket.terminate();
        }
      });
      return true;
    } catch {
      websocket.terminate();
      return false;
    }
  }
}
