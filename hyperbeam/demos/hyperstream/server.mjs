import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  DeviceRequestError,
  HyperstreamClient,
  createPeer,
  memberFields,
  randomId,
} from "./shared.js";
import { WebTorrentTracker } from "./webtorrent-tracker.mjs";

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const root = fileURLToPath(new URL(".", import.meta.url));
const configuredNode = origin(process.env.HYPERBEAM_ORIGIN);
const configuredWhipBase = optionalUrl(process.env.HYPERSTREAM_WHIP_BASE);
const configuredHlsBase = optionalUrl(process.env.HYPERSTREAM_HLS_BASE);
const configuredTracker = optionalUrl(process.env.HYPERSTREAM_TRACKER_URL);
const configuredRtmp = optionalUrl(process.env.HYPERSTREAM_RTMP_BASE);
const internalNode = origin(process.env.HYPERSTREAM_HYPERBEAM_INTERNAL || configuredNode || "http://127.0.0.1:18785");
const mediaApi = loopbackHttpOrigin(process.env.HYPERSTREAM_MEDIAMTX_API || "http://127.0.0.1:9997");
const mediaHls = loopbackHttpOrigin(process.env.HYPERSTREAM_MEDIAMTX_HLS_INTERNAL || "http://127.0.0.1:8888");
const tokenSecret = process.env.HYPERSTREAM_MEDIA_TOKEN_SECRET || randomBytes(32).toString("base64url");
const tokenTtlSeconds = boundedInteger(process.env.HYPERSTREAM_MEDIA_TOKEN_TTL_SECONDS, 900, 300, 86_400);
const trackerTokenTtlSeconds = boundedInteger(
  process.env.HYPERSTREAM_TRACKER_TOKEN_TTL_SECONDS,
  86_400,
  900,
  604_800,
);
const maxTrackerPeers = boundedInteger(process.env.HYPERSTREAM_TRACKER_MAX_PEERS, 2_048, 2, 20_000);
const maxMediaSessions = boundedInteger(process.env.HYPERSTREAM_MAX_MEDIA_SESSIONS, 64, 1, 100);
const maxAdmissionChallenges = boundedInteger(
  process.env.HYPERSTREAM_MAX_ADMISSION_CHALLENGES,
  128,
  8,
  1_024,
);
const admissionChallengeTtlSeconds = boundedInteger(
  process.env.HYPERSTREAM_ADMISSION_CHALLENGE_TTL_SECONDS,
  30,
  15,
  40,
);
const maxSessionRequestsPerMinute = boundedInteger(
  process.env.HYPERSTREAM_MEDIA_SESSION_RATE,
  20,
  1,
  1_000,
);
const maxSessionRequestClients = boundedInteger(
  process.env.HYPERSTREAM_MEDIA_SESSION_CLIENTS,
  4_096,
  16,
  100_000,
);
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/watch.html", ["watch.html", "text/html; charset=utf-8"]],
  ["/favicon.ico", ["favicon.svg", "image/svg+xml"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/broadcaster.js", ["broadcaster.js", "text/javascript; charset=utf-8"]],
  ["/watch.js", ["watch.js", "text/javascript; charset=utf-8"]],
  ["/shared.js", ["shared.js", "text/javascript; charset=utf-8"]],
  ["/whip-client.js", ["whip-client.js", "text/javascript; charset=utf-8"]],
  ["/hybrid-player.js", ["dist/hybrid-player.js", "text/javascript; charset=utf-8"]],
  ["/hyperstream-source.mp4", ["hyperstream-source.mp4", "video/mp4"]],
]);
const sessionRequests = new Map();
const digestRequests = new Map();
const admissionChallenges = new Map();
const mediaReservations = new Map();
const sessionReservations = new Map();
const segmentDigests = new Map();
const admissionClient = new HyperstreamClient(internalNode);
let allocationChain = Promise.resolve();
let digestRequestsInFlight = 0;
const tracker = new WebTorrentTracker({
  intervalSeconds: 120,
  maxConnections: maxTrackerPeers,
  maxPeersPerSwarm: maxTrackerPeers,
  maxSwarmsPerConnection: 1,
});

function optionalUrl(value) {
  if (!value) {
    return null;
  }
  return new URL(value);
}

function origin(value) {
  return value ? new URL(value).origin : null;
}

function loopbackHttpOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("HYPERSTREAM_MEDIAMTX_API must be a credential-free loopback HTTP origin.");
  }
  return url.origin;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function requestOrigin(request) {
  const forwarded = request.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" ? forwarded.split(",", 1)[0] : "http";
  const authority = request.headers.host || `127.0.0.1:${port}`;
  return `${protocol}://${authority}`;
}

function publicBase(request, configured, pathname) {
  if (configured) {
    return new URL(configured).href.replace(/\/$/, "");
  }
  return `${requestOrigin(request)}${pathname}`;
}

function runtimeConfig(request) {
  const pageOrigin = requestOrigin(request);
  const trackerUrl = configuredTracker
    ? configuredTracker.href
    : `${pageOrigin.startsWith("https:") ? "wss" : "ws"}://${request.headers.host}/tracker`;
  return {
    hyperbeamOrigin: configuredNode || "http://127.0.0.1:18785",
    mediaChallengeEndpoint: `${pageOrigin}/api/media-challenge`,
    mediaSessionEndpoint: `${pageOrigin}/api/media-session`,
    trackerUrl,
    rtmpEnabled: Boolean(configuredRtmp),
    architecture: "hyperstream-hls-p2p@1",
  };
}

function contentSecurityPolicy(request) {
  const sources = new Set(["'self'", "stun:", "turn:", "turns:"]);
  const mediaSources = new Set(["'self'", "blob:"]);
  for (const value of [configuredNode, configuredWhipBase?.origin, configuredHlsBase?.origin]) {
    if (value) {
      sources.add(value);
    }
  }
  if (configuredHlsBase?.origin) {
    mediaSources.add(configuredHlsBase.origin);
  }
  sources.add(new URL(configuredTracker?.href || runtimeTrackerUrl(request)).origin);
  return `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${Array.from(sources).join(" ")}; img-src 'self' data:; media-src ${Array.from(mediaSources).join(" ")}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`;
}

function headers(request) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": contentSecurityPolicy(request),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
  };
}

function reply(request, response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    ...headers(request),
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function replyJson(request, response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...headers(request),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

async function readJson(request, maximumBytes = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new RequestError(413, "request-too-large");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new RequestError(400, "invalid-json");
  }
}

class RequestError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
  }
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return typeof forwarded === "string"
    ? forwarded.split(",", 1)[0].trim()
    : request.socket.remoteAddress || "unknown";
}

function admitSessionRequest(request) {
  const now = Date.now();
  const key = clientIp(request);
  if (!sessionRequests.has(key) && sessionRequests.size >= maxSessionRequestClients) {
    for (const [client, timestamps] of sessionRequests) {
      const recent = timestamps.filter((timestamp) => now - timestamp < 60_000);
      if (recent.length === 0) {
        sessionRequests.delete(client);
      } else {
        sessionRequests.set(client, recent);
      }
    }
    if (sessionRequests.size >= maxSessionRequestClients) {
      return false;
    }
  }
  const previous = sessionRequests.get(key) || [];
  const recent = previous.filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= maxSessionRequestsPerMinute) {
    sessionRequests.set(key, recent);
    return false;
  }
  recent.push(now);
  sessionRequests.set(key, recent);
  return true;
}

function signMediaToken(mediaId, expiresAt) {
  const message = `${mediaId}.${expiresAt}`;
  const signature = createHmac("sha256", tokenSecret).update(message).digest("base64url");
  return `${expiresAt}.${signature}`;
}

function signature(scope, value, bytes = 16) {
  return createHmac("sha256", tokenSecret)
    .update(`${scope}:${value}`)
    .digest()
    .subarray(0, bytes)
    .toString("base64url");
}

function equalText(left, right) {
  const supplied = Buffer.from(String(left || ""), "utf8");
  const expected = Buffer.from(String(right || ""), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function validMediaToken(mediaId, token) {
  if (typeof token !== "string" || token.length > 256) {
    return false;
  }
  const [expiresText, suppliedSignature, extra] = token.split(".");
  const expiresAt = Number.parseInt(expiresText || "", 10);
  if (extra !== undefined || !Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = signMediaToken(mediaId, expiresAt).split(".")[1];
  return equalText(suppliedSignature, expected);
}

function releaseToken(mediaId) {
  return signature("release", mediaId, 32);
}

function validReleaseToken(mediaId, token) {
  return typeof token === "string" && equalText(token, releaseToken(mediaId));
}

function trackerToken(mediaId, expiresAt) {
  return signature("tracker", `${mediaId}.${expiresAt}`, 32);
}

function validTrackerToken(mediaId, expiresAt, token, now = Math.floor(Date.now() / 1_000)) {
  return (
    validMediaId(mediaId) &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt >= now &&
    typeof token === "string" &&
    equalText(token, trackerToken(mediaId, expiresAt))
  );
}

function validMediaId(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = value.match(/^hs-([A-Za-z0-9_-]{24})-([A-Za-z0-9_-]{22})$/);
  return Boolean(match && equalText(match[2], signature("media-id", match[1])));
}

function createMediaId() {
  const nonce = randomBytes(18).toString("base64url");
  return `hs-${nonce}-${signature("media-id", nonce)}`;
}

function runtimeTrackerUrl(request = null) {
  if (configuredTracker) {
    return configuredTracker.href;
  }
  if (!request) {
    throw new Error("A request is required to derive the tracker URL.");
  }
  const pageOrigin = requestOrigin(request);
  return `${pageOrigin.startsWith("https:") ? "wss" : "ws"}://${request.headers.host}/tracker`;
}

function mediaPath(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.startsWith("/") ? value.slice(1) : value;
  if (normalized.includes("/")) {
    return null;
  }
  return validMediaId(normalized) ? normalized : null;
}

function validIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function challengeKey(sessionId, publisherId) {
  return `${sessionId}\u0000${publisherId}`;
}

async function leaveAdmissionChallenge(challenge) {
  if (!challenge?.peer?.generation || challenge.left) {
    return;
  }
  challenge.left = true;
  await admissionClient.call(
    "leave",
    memberFields(challenge.sessionId, challenge.peer),
    { silent: true },
  ).catch(() => {});
}

async function pruneAdmissionChallenges() {
  const now = Date.now();
  const expired = [];
  for (const [challengeId, challenge] of admissionChallenges) {
    if (challenge.expiresAt <= now) {
      admissionChallenges.delete(challengeId);
      if (challenge.key && admissionChallenges.get(challenge.key) === challenge) {
        admissionChallenges.delete(challenge.key);
      }
      expired.push(leaveAdmissionChallenge(challenge));
    }
  }
  await Promise.all(expired);
}

function challengeResponse(challenge) {
  return {
    challengeId: challenge.id,
    adapterPeerId: challenge.peer.id,
    adapterGeneration: challenge.peer.generation,
    connectionId: challenge.connectionId,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  };
}

async function createMediaChallenge(request, response) {
  if (!admitSessionRequest(request)) {
    replyJson(request, response, 429, { error: "rate-limited" });
    return;
  }
  const body = await readJson(request);
  if (
    !validIdentifier(body.sessionId) ||
    !validIdentifier(body.publisherId) ||
    (body.joinToken !== undefined &&
      (typeof body.joinToken !== "string" || body.joinToken.length > 512))
  ) {
    throw new RequestError(400, "invalid-session-descriptor");
  }
  await pruneAdmissionChallenges();
  const key = challengeKey(body.sessionId, body.publisherId);
  const existing = admissionChallenges.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    replyJson(request, response, 201, challengeResponse(existing));
    return;
  }
  if (admissionChallenges.size / 2 >= maxAdmissionChallenges) {
    throw new RequestError(503, "admission-capacity-reached");
  }
  const peer = createPeer("media-admission", "adapter");
  let joined = null;
  try {
    const joinRequest = {
      "request-id": randomId("media-admission"),
      "session-id": body.sessionId,
      "peer-id": peer.id,
      metadata: {
        role: "media-admission",
        client: "hyperstream-media-adapter",
      },
    };
    if (body.joinToken) {
      joinRequest["join-token"] = body.joinToken;
    }
    joined = await admissionClient.call("join", joinRequest);
    peer.generation = Number(joined["peer-generation"] || 0);
    peer.cursor = Number(joined["current-cursor"] || 0);
    const metadata = joined.metadata;
    const publisher = Array.isArray(joined.peers)
      ? joined.peers.find((candidate) => candidate["peer-id"] === body.publisherId)
      : null;
    if (
      joined["session-status"] !== "live" ||
      metadata?.protocol !== "hyperstream-hls-p2p@1" ||
      metadata?.role !== "publisher" ||
      metadata?.["publisher-peer-id"] !== body.publisherId ||
      metadata?.status !== "starting" ||
      !publisher ||
      !Number.isInteger(Number(publisher["peer-generation"]))
    ) {
      throw new RequestError(403, "hyperstream-owner-required");
    }
    const id = randomBytes(24).toString("base64url");
    const challenge = {
      id,
      key,
      sessionId: body.sessionId,
      publisherId: body.publisherId,
      publisherGeneration: Number(publisher["peer-generation"]),
      peer,
      connectionId: randomId("media-admission"),
      expiresAt: Date.now() + admissionChallengeTtlSeconds * 1_000,
      completedMediaId: null,
      proofAccepted: false,
      left: false,
    };
    admissionChallenges.set(id, challenge);
    admissionChallenges.set(key, challenge);
    replyJson(request, response, 201, challengeResponse(challenge));
  } catch (error) {
    if (joined && peer.generation) {
      await admissionClient.call(
        "leave",
        memberFields(body.sessionId, peer),
        { silent: true },
      ).catch(() => {});
    }
    if (error instanceof RequestError) {
      throw error;
    }
    if (error instanceof DeviceRequestError && error.status < 500) {
      throw new RequestError(403, "hyperstream-owner-required");
    }
    throw new RequestError(503, "hyperstream-admission-unavailable");
  }
}

async function mediaApiRequest(pathname, options = {}) {
  const response = await fetch(`${mediaApi}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    const error = new Error(`MediaMTX API returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function activeMediaPaths() {
  const payload = await mediaApiRequest("/v3/paths/list?itemsPerPage=100");
  const paths = new Set();
  for (const item of Array.isArray(payload?.items) ? payload.items : []) {
    if (validMediaId(item?.name)) {
      paths.add(item.name);
    }
  }
  return paths;
}

function removeMediaReservation(mediaId) {
  const reservation = mediaReservations.get(mediaId);
  tracker.revoke(mediaId);
  mediaReservations.delete(mediaId);
  if (reservation?.sessionId && reservation?.publisherId) {
    const key = challengeKey(reservation.sessionId, reservation.publisherId);
    if (sessionReservations.get(key) === mediaId) {
      sessionReservations.delete(key);
    }
  }
  for (const key of segmentDigests.keys()) {
    if (key.startsWith(`${mediaId}/`)) {
      segmentDigests.delete(key);
    }
  }
}

function recoverMediaReservation(mediaId) {
  const existing = mediaReservations.get(mediaId);
  if (existing) {
    return existing;
  }
  const reservation = {
    active: true,
    activeAt: Date.now(),
    connections: new Map(),
    expiresAt: Number.MAX_SAFE_INTEGER,
    mediaId,
    media: null,
    publisherId: null,
    recovered: true,
    sessionId: null,
    swarmId: null,
    trackerExpiresAt: null,
  };
  mediaReservations.set(mediaId, reservation);
  return reservation;
}

async function ensureActiveMediaReservation(mediaId) {
  const reservation = mediaReservations.get(mediaId);
  if (reservation) {
    return reservation;
  }
  const activePaths = await activeMediaPaths();
  return activePaths.has(mediaId) ? recoverMediaReservation(mediaId) : null;
}

async function reconcileMediaReservations() {
  const activePaths = await activeMediaPaths();
  const now = Date.now();
  for (const [mediaId, reservation] of mediaReservations) {
    const active = activePaths.has(mediaId);
    if (
      (!reservation.active && reservation.expiresAt * 1_000 <= now) ||
      (reservation.active && !active && now - reservation.activeAt > 10_000)
    ) {
      removeMediaReservation(mediaId);
    }
  }
  return activePaths;
}

function withAllocationLock(task) {
  const result = allocationChain.then(task, task);
  allocationChain = result.catch(() => {});
  return result;
}

function buildMediaReservation(request, challenge) {
  const mediaId = createMediaId();
  const expiresAt = Math.floor(Date.now() / 1000) + tokenTtlSeconds;
  const trackerExpiresAt = Math.floor(Date.now() / 1000) + trackerTokenTtlSeconds;
  const token = signMediaToken(mediaId, expiresAt);
  const whipBase = publicBase(request, configuredWhipBase, "/whip");
  const hlsBase = publicBase(request, configuredHlsBase, "/hls");
  const swarmId = `hyperstream:${challenge.sessionId}:${mediaId}:1:source`;
  const media = {
    mediaId,
    whipUrl: `${whipBase}/${mediaId}/whip`,
    whipToken: token,
    releaseToken: releaseToken(mediaId),
    manifestUrl: `${hlsBase}/${mediaId}/index.m3u8`,
    digestUrl: `${requestOrigin(request)}/api/media-digest/${mediaId}`,
    trackerUrl: trackerUrlForRequest(request, mediaId, trackerExpiresAt),
    swarmId,
    streamEpoch: 1,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
  };
  if (configuredRtmp) {
    media.rtmpServer = configuredRtmp.href.replace(/\/$/, "");
    media.rtmpKey = `${mediaId}?token=${encodeURIComponent(token)}`;
  }
  const reservation = {
    active: false,
    activeAt: 0,
    connections: new Map(),
    expiresAt,
    mediaId,
    media,
    publisherId: challenge.publisherId,
    sessionId: challenge.sessionId,
    swarmId,
    trackerExpiresAt,
  };
  mediaReservations.set(mediaId, reservation);
  sessionReservations.set(challenge.key, mediaId);
  return reservation;
}

function validAdmissionProof(event, challenge) {
  const body = event?.body;
  return (
    event?.type === "signal" &&
    event.kind === "media-admission-proof" &&
    event["from-peer-id"] === challenge.publisherId &&
    Number(event["from-peer-generation"]) === challenge.publisherGeneration &&
    event["to-peer-id"] === challenge.peer.id &&
    event["connection-id"] === challenge.connectionId &&
    body?.protocol === "hyperstream-hls-p2p@1" &&
    body["challenge-id"] === challenge.id &&
    body["session-id"] === challenge.sessionId &&
    body["publisher-peer-id"] === challenge.publisherId &&
    Number(body["publisher-generation"]) === challenge.publisherGeneration &&
    body["adapter-peer-id"] === challenge.peer.id &&
    Number(body["adapter-generation"]) === challenge.peer.generation
  );
}

async function findAdmissionProof(challenge) {
  let after = challenge.peer.cursor;
  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
    const page = await admissionClient.call(
      "events",
      {
        ...memberFields(challenge.sessionId, challenge.peer),
        after,
        limit: 100,
      },
      { silent: true },
    );
    const events = Array.isArray(page.events) ? page.events : [];
    const proof = events.find((event) => validAdmissionProof(event, challenge));
    after = Number(page["next-cursor"] || after);
    challenge.peer.cursor = after;
    if (proof) {
      return proof;
    }
    if (!(page["has-more"] === true || page["has-more"] === "true")) {
      return null;
    }
  }
  return null;
}

async function deliverMediaCredentials(challenge, reservation) {
  await admissionClient.call(
    "signal",
    {
      ...memberFields(challenge.sessionId, challenge.peer),
      "request-id": `media-session-${challenge.id}`,
      "to-peer-id": challenge.publisherId,
      "connection-id": challenge.connectionId,
      kind: "media-session",
      "content-type": "application/json",
      body: {
        protocol: "hyperstream-hls-p2p@1",
        "challenge-id": challenge.id,
        "session-id": challenge.sessionId,
        "publisher-peer-id": challenge.publisherId,
        "publisher-generation": challenge.publisherGeneration,
        media: reservation.media,
      },
    },
    { silent: true },
  );
}

async function createMediaSession(request, response) {
  if (!admitSessionRequest(request)) {
    replyJson(request, response, 429, { error: "rate-limited" });
    return;
  }
  const body = await readJson(request);
  if (typeof body.challengeId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(body.challengeId)) {
    throw new RequestError(400, "invalid-admission-challenge");
  }
  await pruneAdmissionChallenges();
  const challenge = admissionChallenges.get(body.challengeId);
  if (!challenge || challenge.expiresAt <= Date.now() || challenge.left) {
    throw new RequestError(410, "admission-challenge-expired");
  }
  if (!challenge.proofAccepted) {
    let proof;
    try {
      proof = await findAdmissionProof(challenge);
    } catch {
      throw new RequestError(503, "hyperstream-admission-unavailable");
    }
    if (!proof) {
      throw new RequestError(409, "admission-proof-pending");
    }
    challenge.proofAccepted = true;
  }
  await withAllocationLock(async () => {
    let reservation = challenge.completedMediaId
      ? mediaReservations.get(challenge.completedMediaId)
      : null;
    const existingMediaId = sessionReservations.get(challenge.key);
    if (!reservation && existingMediaId) {
      reservation = mediaReservations.get(existingMediaId);
    }
    if (!reservation) {
      let activePaths;
      try {
        activePaths = await reconcileMediaReservations();
      } catch {
        throw new RequestError(503, "media-adapter-unavailable");
      }
      const allocated = new Set([...activePaths, ...mediaReservations.keys()]);
      if (allocated.size >= maxMediaSessions) {
        throw new RequestError(503, "media-capacity-reached");
      }
      reservation = buildMediaReservation(request, challenge);
    }
    await deliverMediaCredentials(challenge, reservation);
    challenge.completedMediaId = reservation.mediaId;
  });
  replyJson(request, response, 202, { accepted: true });
}

function trackerUrlForRequest(request, mediaId, expiresAt) {
  const url = new URL(configuredTracker?.href || runtimeTrackerUrl(request));
  url.searchParams.set("media", mediaId);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("token", trackerToken(mediaId, expiresAt));
  return url.href;
}

function validSegmentPath(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{12,32}_(?:video|audio)\d+_(?:init|seg\d+)\.mp4$/.test(value)
  );
}

function segmentLocator(mediaId, url, reserved = mediaReservations.has(mediaId)) {
  const segment = url.searchParams.get("segment");
  const sessionId = url.searchParams.get("session");
  if (
    !validMediaId(mediaId) ||
    !reserved ||
    !validSegmentPath(segment) ||
    typeof sessionId !== "string" ||
    !/^[0-9a-f-]{16,64}$/i.test(sessionId) ||
    Array.from(url.searchParams.keys()).some((key) => !["segment", "session"].includes(key)) ||
    url.searchParams.getAll("segment").length !== 1 ||
    url.searchParams.getAll("session").length !== 1
  ) {
    return null;
  }
  return { segment, sessionId };
}

function admitDigestRequest(request) {
  const now = Date.now();
  const key = clientIp(request);
  if (!digestRequests.has(key) && digestRequests.size >= maxSessionRequestClients) {
    for (const [client, value] of digestRequests) {
      if (now - value.startedAt >= 60_000) {
        digestRequests.delete(client);
      }
    }
    if (digestRequests.size >= maxSessionRequestClients) {
      return false;
    }
  }
  const previous = digestRequests.get(key);
  const value = !previous || now - previous.startedAt >= 60_000
    ? { startedAt: now, count: 0 }
    : previous;
  if (value.count >= 6_000) {
    digestRequests.set(key, value);
    return false;
  }
  value.count += 1;
  digestRequests.set(key, value);
  return true;
}

async function calculateSegmentDigest(mediaId, segment, sessionId) {
  if (digestRequestsInFlight >= 32) {
    throw new RequestError(429, "digest-capacity-reached");
  }
  digestRequestsInFlight += 1;
  try {
    const segmentUrl = new URL(`${mediaHls}/${mediaId}/${segment}`);
    segmentUrl.searchParams.set("session", sessionId);
    const response = await fetch(segmentUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || response.status !== 200 || !response.body || !contentType.startsWith("video/mp4")) {
      throw new RequestError(404, "segment-unavailable");
    }
    const hash = createHash("sha256");
    const reader = response.body.getReader();
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 24 * 1024 * 1024) {
        await reader.cancel();
        throw new RequestError(413, "segment-too-large");
      }
      hash.update(value);
    }
    if (size === 0) {
      throw new RequestError(404, "segment-unavailable");
    }
    return { bytes: size, sha256: hash.digest("base64url") };
  } finally {
    digestRequestsInFlight -= 1;
  }
}

async function segmentDigest(request, response, mediaId, url) {
  let reservation = null;
  if (validMediaId(mediaId)) {
    try {
      reservation = await ensureActiveMediaReservation(mediaId);
    } catch {
      throw new RequestError(503, "media-adapter-unavailable");
    }
  }
  const locator = segmentLocator(mediaId, url, Boolean(reservation));
  if (!locator) {
    throw new RequestError(400, "invalid-segment-locator");
  }
  const { segment, sessionId } = locator;
  if (!admitDigestRequest(request)) {
    throw new RequestError(429, "rate-limited");
  }
  const positiveKey = `${mediaId}/${segment}`;
  const requestKey = `${positiveKey}?session=${sessionId}`;
  const now = Date.now();
  let cached = segmentDigests.get(positiveKey);
  if (!cached || cached.failedAt) {
    cached = segmentDigests.get(requestKey);
  }
  const cacheTtl = cached?.failedAt ? 5_000 : 300_000;
  const cacheAge = cached ? now - (cached.failedAt || cached.createdAt) : 0;
  if (!cached || cacheAge > cacheTtl) {
    segmentDigests.delete(positiveKey);
    segmentDigests.delete(requestKey);
    if (segmentDigests.size >= 4_096) {
      segmentDigests.delete(segmentDigests.keys().next().value);
    }
    cached = { createdAt: now, failedAt: 0, promise: null };
    cached.promise = calculateSegmentDigest(mediaId, segment, sessionId)
      .then((result) => {
        segmentDigests.delete(requestKey);
        segmentDigests.set(positiveKey, {
          createdAt: Date.now(),
          failedAt: 0,
          promise: Promise.resolve(result),
        });
        return result;
      })
      .catch((error) => {
        cached.failedAt = Date.now();
        throw error;
      });
    segmentDigests.set(requestKey, cached);
  }
  replyJson(request, response, 200, await cached.promise, {
    "Cache-Control": "public, max-age=60",
  });
}

function loopbackRequest(request) {
  if (request.headers["x-forwarded-for"]) {
    return false;
  }
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function authorizeMedia(request, response) {
  if (!loopbackRequest(request)) {
    reply(request, response, 404, "Not Found\n");
    return;
  }
  const body = await readJson(request, 8_192);
  const path = mediaPath(body.path);
  if (!path) {
    reply(request, response, 403, "Forbidden\n");
    return;
  }
  if (body.action === "read" || body.action === "playback") {
    let activeReservation = null;
    try {
      activeReservation = await ensureActiveMediaReservation(path);
    } catch {
    }
    if (activeReservation) {
      reply(request, response, 200, "OK\n");
      return;
    }
  }
  const reservation = mediaReservations.get(path);
  if (body.action === "publish" && reservation && validMediaToken(path, body.token)) {
    reservation.active = true;
    reservation.activeAt = Date.now();
    const resource = mediaResource(body.protocol, body.id);
    if (resource) {
      reservation.connections.set(`${resource.kind}:${resource.id}`, resource);
    }
    reply(request, response, 200, "OK\n");
    return;
  }
  reply(request, response, 401, "Unauthorized\n");
}

function mediaResource(protocol, id) {
  if (typeof id !== "string" || !/^[0-9a-f-]{16,64}$/i.test(id)) {
    return null;
  }
  if (protocol === "rtmp") {
    return { kind: "rtmpconns", id };
  }
  if (protocol === "webrtc") {
    return { kind: "webrtcsessions", id };
  }
  return null;
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === "string" ? authorization.match(/^Bearer ([^\s]+)$/) : null;
  return match?.[1] || null;
}

async function discoverMediaResources(mediaId, request = mediaApiRequest) {
  const resources = new Map();
  for (const kind of ["rtmpconns", "webrtcsessions"]) {
    let payload;
    try {
      payload = await request(`/v3/${kind}/list?itemsPerPage=100`);
    } catch (error) {
      if (error?.status === 404) {
        continue;
      }
      throw error;
    }
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      if (item?.path === mediaId && typeof item.id === "string") {
        resources.set(`${kind}:${item.id}`, { kind, id: item.id });
      }
    }
  }
  return resources;
}

async function releaseMediaSession(request, response, mediaId) {
  const token = bearerToken(request);
  if (!validMediaId(mediaId) || !validReleaseToken(mediaId, token)) {
    replyJson(request, response, 401, { error: "invalid-media-credential" });
    return;
  }
  const reservation = mediaReservations.get(mediaId);
  const resources = new Map(reservation?.connections || []);
  try {
    for (const [key, value] of await discoverMediaResources(mediaId)) {
      resources.set(key, value);
    }
  } catch {
  }
  let kicked = 0;
  for (const resource of resources.values()) {
    try {
      await mediaApiRequest(
        `/v3/${resource.kind}/kick/${encodeURIComponent(resource.id)}`,
        { method: "POST" },
      );
      kicked += 1;
    } catch {
    }
  }
  let remaining;
  try {
    remaining = await discoverMediaResources(mediaId);
  } catch {
    remaining = null;
  }
  if (remaining && remaining.size === 0) {
    removeMediaReservation(mediaId);
    replyJson(request, response, 200, { released: true, kicked });
  } else {
    replyJson(request, response, 502, { error: "media-release-unconfirmed" });
  }
}

async function serveFile(request, response, entry) {
  const [filename, contentType] = entry;
  const path = fileURLToPath(new URL(filename, `file://${root}`));
  try {
    const metadata = await stat(path);
    response.writeHead(200, {
      ...headers(request),
      "Content-Type": contentType,
      "Content-Length": metadata.size,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  } catch {
    reply(request, response, 500, "Internal Server Error\n");
  }
}

const server = createServer(async (request, response) => {
  let requestUrl;
  let pathname;
  try {
    requestUrl = new URL(request.url || "/", "http://localhost");
    pathname = requestUrl.pathname;
  } catch {
    reply(request, response, 400, "Bad Request\n");
    return;
  }

  try {
    if (request.method === "GET" && pathname === "/runtime-config.json") {
      replyJson(request, response, 200, runtimeConfig(request));
      return;
    }
    if (request.method === "POST" && pathname === "/api/media-challenge") {
      await createMediaChallenge(request, response);
      return;
    }
    if (request.method === "POST" && pathname === "/api/media-session") {
      await createMediaSession(request, response);
      return;
    }
    if (request.method === "POST" && pathname === "/api/media-auth") {
      await authorizeMedia(request, response);
      return;
    }
    const digest = pathname.match(/^\/api\/media-digest\/(hs-[A-Za-z0-9_-]+)$/);
    if (request.method === "GET" && digest) {
      await segmentDigest(request, response, digest[1], requestUrl);
      return;
    }
    const release = pathname.match(/^\/api\/media-session\/(hs-[A-Za-z0-9_-]+)$/);
    if (request.method === "DELETE" && release) {
      await releaseMediaSession(request, response, release[1]);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method || "")) {
      reply(request, response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    const entry = files.get(pathname);
    if (!entry) {
      reply(request, response, 404, "Not Found\n");
      return;
    }
    await serveFile(request, response, entry);
  } catch (error) {
    if (error instanceof RequestError) {
      replyJson(request, response, error.status, { error: error.message });
      return;
    }
    replyJson(request, response, 500, { error: "internal-error" });
  }
});

function trackerOriginAllowed(request) {
  const originHeader = request.headers.origin;
  if (typeof originHeader !== "string") {
    return false;
  }
  try {
    return new URL(originHeader).host === request.headers.host;
  } catch {
    return false;
  }
}

async function trackerCapability(request) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const mediaId = url.searchParams.get("media");
    const expiresAt = Number.parseInt(url.searchParams.get("expires") || "", 10);
    const token = url.searchParams.get("token");
    if (!validTrackerToken(mediaId, expiresAt, token)) {
      return null;
    }
    const reservation = await ensureActiveMediaReservation(mediaId);
    if (
      !reservation ||
      (!reservation.recovered && reservation.trackerExpiresAt !== expiresAt)
    ) {
      return null;
    }
    return {
      clientKey: clientIp(request),
      expiresAt: expiresAt * 1_000,
      scope: mediaId,
    };
  } catch {
    return null;
  }
}

server.on("upgrade", async (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url || "/", "http://localhost").pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (
    pathname !== "/tracker" ||
    !trackerOriginAllowed(request) ||
    tracker.connectionCount >= maxTrackerPeers
  ) {
    socket.destroy();
    return;
  }
  const capability = await trackerCapability(request);
  if (!capability || socket.destroyed) {
    socket.destroy();
    return;
  }
  tracker.handleUpgrade(request, socket, head, capability);
});

async function closeServer() {
  tracker.close();
  if (!server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

if (process.env.HYPERSTREAM_SERVER_NO_LISTEN !== "1") {
  server.listen(port, host);
}

export {
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
};
