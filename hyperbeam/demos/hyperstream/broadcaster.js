import {
  DeviceRequestError,
  HyperstreamClient,
  Telemetry,
  createPeer,
  defaultNodeEndpoint,
  encodeInvite,
  formatBytes,
  formatElapsed,
  memberFields,
  normalizeEndpoint,
  randomId,
  responseHasMore,
  retryableRequestError,
  safeBodySize,
  wait,
} from "./shared.js";
import { WhipPublisher } from "./whip-client.js";

const PROTOCOL = "hyperstream-hls-p2p@1";
const MANIFEST_TIMEOUT_MS = 120_000;
const ADAPTER_REQUEST_TIMEOUT_MS = 5_000;

const elements = {
  nodeForm: document.querySelector("#node-form"),
  nodeUrl: document.querySelector("#node-url"),
  probeButton: document.querySelector("#probe-button"),
  nodeDot: document.querySelector("#node-dot"),
  nodeStatus: document.querySelector("#node-status"),
  ingestMode: document.querySelector("#ingest-mode"),
  startButton: document.querySelector("#start-button"),
  stopButton: document.querySelector("#stop-button"),
  publisherCanvas: document.querySelector("#publisher-canvas"),
  publisherVideo: document.querySelector("#publisher-video"),
  liveLabel: document.querySelector("#live-label"),
  liveLabelText: document.querySelector("#live-label-text"),
  timecode: document.querySelector("#timecode"),
  sourceReadout: document.querySelector("#source-readout"),
  viewerReadout: document.querySelector("#viewer-readout"),
  controlReadout: document.querySelector("#control-readout"),
  watchUrl: document.querySelector("#watch-url"),
  copyButton: document.querySelector("#copy-button"),
  openButton: document.querySelector("#open-button"),
  shareHelp: document.querySelector("#share-help"),
  ingestHelp: document.querySelector("#ingest-help"),
  rtmpServer: document.querySelector("#rtmp-server"),
  rtmpKey: document.querySelector("#rtmp-key"),
  copyRtmpServer: document.querySelector("#copy-rtmp-server"),
  copyRtmpKey: document.querySelector("#copy-rtmp-key"),
  viewerCount: document.querySelector("#viewer-count"),
  viewerList: document.querySelector("#viewer-list"),
  viewerEmpty: document.querySelector("#viewer-empty"),
  sessionStatus: document.querySelector("#session-status"),
  sessionId: document.querySelector("#session-id"),
  ownerPeer: document.querySelector("#owner-peer"),
  ownerGeneration: document.querySelector("#owner-generation"),
  sessionCursor: document.querySelector("#session-cursor"),
  sessionPeers: document.querySelector("#session-peers"),
  proofCount: document.querySelector("#proof-count"),
  proofList: document.querySelector("#proof-list"),
  requestCount: document.querySelector("#request-count"),
  signalCount: document.querySelector("#signal-count"),
  connectionCount: document.querySelector("#connection-count"),
  cachePolicy: document.querySelector("#cache-policy"),
  ingestStatus: document.querySelector("#ingest-status"),
  ingestIce: document.querySelector("#ingest-ice"),
  ingestRoute: document.querySelector("#ingest-route"),
  ingestFps: document.querySelector("#ingest-fps"),
  ingestBytes: document.querySelector("#ingest-bytes"),
  manifestStatus: document.querySelector("#manifest-status"),
  trackerStatus: document.querySelector("#tracker-status"),
  eventLog: document.querySelector("#event-log"),
  eventEmpty: document.querySelector("#event-empty"),
  clearButton: document.querySelector("#clear-button"),
};

const telemetry = new Telemetry(elements.eventLog, elements.eventEmpty);

const state = {
  runtime: null,
  client: null,
  endpoint: "",
  running: false,
  stopping: false,
  closeUnconfirmed: false,
  runId: 0,
  sessionId: null,
  owner: null,
  media: null,
  publisherStream: null,
  publisher: null,
  watchUrl: "",
  playbackPublished: false,
  serverPeers: new Map(),
  viewerStates: new Map(),
  intervals: new Set(),
  proofs: new Set(),
  requestCount: 0,
  signalCount: 0,
  latestCursor: 0,
  startedAt: 0,
  fatalHandled: false,
  heartbeatFailures: 0,
  previousWhipStats: null,
};

function setNodeState(mode, text) {
  elements.nodeDot.classList.remove("online", "error");
  if (mode) {
    elements.nodeDot.classList.add(mode);
  }
  elements.nodeStatus.textContent = text;
}

function setRunControls(active) {
  elements.startButton.disabled = active;
  elements.stopButton.disabled = !active;
  elements.nodeUrl.disabled = active;
  elements.probeButton.disabled = active;
  elements.ingestMode.disabled = active;
}

function setControlState(value) {
  elements.controlReadout.textContent = value;
}

function markProof(name) {
  if (state.proofs.has(name)) {
    return;
  }
  state.proofs.add(name);
  elements.proofList.querySelector(`[data-proof="${name}"]`)?.classList.add("complete");
  elements.proofCount.textContent = `${state.proofs.size} / 5`;
}

function resetProofs() {
  state.proofs.clear();
  elements.proofList.querySelectorAll("li").forEach((item) => item.classList.remove("complete"));
  elements.proofCount.textContent = "0 / 5";
}

function onDeviceRequest(summary) {
  state.requestCount += 1;
  elements.requestCount.textContent = String(state.requestCount);
  if (state.client?.cacheProved) {
    elements.cachePolicy.textContent = "no-store";
  }
  if (summary.silent && !summary.error) {
    return;
  }
  telemetry.add({
    source: "device",
    code: String(summary.status),
    message: `POST /${summary.operation}${summary.error ? " rejected" : ""}`,
    meta: summary.error
      ? summary.reason
      : `${summary.duration} ms · ${formatBytes(summary.bytes)}`,
    error: summary.error,
  });
}

async function loadRuntimeConfig() {
  const response = await fetch("./runtime-config.json", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error(`Runtime configuration returned HTTP ${response.status}.`);
  }
  const config = await response.json();
  if (
    config?.architecture !== PROTOCOL ||
    typeof config.hyperbeamOrigin !== "string" ||
    typeof config.mediaChallengeEndpoint !== "string" ||
    typeof config.mediaSessionEndpoint !== "string" ||
    typeof config.trackerUrl !== "string" ||
    typeof config.rtmpEnabled !== "boolean"
  ) {
    throw new Error("Runtime configuration is invalid.");
  }
  state.runtime = {
    ...config,
    mediaChallengeEndpoint: runtimeApiEndpoint(config.mediaChallengeEndpoint),
    mediaSessionEndpoint: runtimeApiEndpoint(config.mediaSessionEndpoint),
  };
  elements.nodeUrl.value = config.hyperbeamOrigin || defaultNodeEndpoint();
  const rtmpOption = elements.ingestMode.querySelector('option[value="rtmp"]');
  if (rtmpOption) {
    rtmpOption.disabled = !config.rtmpEnabled;
    rtmpOption.textContent = config.rtmpEnabled
      ? "External OBS / RTMP"
      : "External OBS / RTMP (disabled)";
  }
  if (!config.rtmpEnabled && elements.ingestMode.value === "rtmp") {
    elements.ingestMode.value = "browser";
  }
  if (!config.rtmpEnabled) {
    elements.rtmpServer.value = "RTMP is not exposed by this deployment";
    elements.ingestHelp.textContent = "Browser WHIP ingest is available; RTMP is disabled here.";
  }
}

function runtimeApiEndpoint(value) {
  const url = new URL(value, window.location.href);
  if (
    url.origin !== window.location.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Media adapter endpoints must be credential-free and same-origin.");
  }
  return url.href;
}

async function probeNode({ quiet = false } = {}) {
  elements.probeButton.disabled = true;
  setNodeState("", "Probing");
  try {
    state.endpoint = normalizeEndpoint(elements.nodeUrl.value);
    state.client = new HyperstreamClient(state.endpoint, onDeviceRequest);
    const latency = await state.client.probe();
    setNodeState("online", `Online · ${latency} ms`);
    if (!quiet) {
      telemetry.add({
        source: "node",
        code: "OK",
        message: "HyperBEAM metadata route responded",
        meta: state.endpoint,
      });
    }
    return true;
  } catch (error) {
    setNodeState("error", "Node unavailable");
    if (!quiet) {
      telemetry.add({
        source: "node",
        code: "ERR",
        message: "HyperBEAM probe failed",
        meta: error instanceof Error ? error.message : "network-error",
        error: true,
      });
    }
    return false;
  } finally {
    elements.probeButton.disabled = state.running || elements.nodeUrl.disabled;
  }
}

function clearIntervals() {
  for (const interval of state.intervals) {
    window.clearInterval(interval);
  }
  state.intervals.clear();
}

function addInterval(callback, milliseconds) {
  const interval = window.setInterval(callback, milliseconds);
  state.intervals.add(interval);
}

function resetRunState() {
  state.runId += 1;
  state.running = false;
  state.stopping = false;
  state.closeUnconfirmed = false;
  state.sessionId = `broadcast-${crypto.randomUUID().slice(0, 20)}`;
  state.owner = createPeer("publisher", "publisher");
  state.media = null;
  state.publisherStream = null;
  state.publisher = null;
  state.watchUrl = "";
  state.playbackPublished = false;
  state.serverPeers = new Map();
  state.viewerStates = new Map();
  state.proofs = new Set();
  state.requestCount = 0;
  state.signalCount = 0;
  state.latestCursor = 0;
  state.startedAt = performance.now();
  state.fatalHandled = false;
  state.heartbeatFailures = 0;
  state.previousWhipStats = null;
  clearIntervals();
  telemetry.reset();
  resetProofs();

  elements.requestCount.textContent = "0";
  elements.signalCount.textContent = "0";
  elements.connectionCount.textContent = "0 / 1";
  elements.cachePolicy.textContent = "Unproven";
  elements.sessionStatus.textContent = "Starting";
  elements.sessionId.textContent = state.sessionId;
  elements.ownerPeer.textContent = state.owner.id;
  elements.ownerGeneration.textContent = "0";
  elements.sessionCursor.textContent = "0";
  elements.sessionPeers.textContent = "0";
  elements.watchUrl.value = "Waiting for live HLS manifest";
  elements.copyButton.disabled = true;
  elements.openButton.disabled = true;
  elements.shareHelp.textContent = "The watch URL is published only after HTTPS fallback is live.";
  elements.rtmpServer.value = "RTMP server will appear here";
  elements.rtmpKey.value = "";
  elements.copyRtmpServer.disabled = true;
  elements.copyRtmpKey.disabled = true;
  elements.ingestHelp.textContent = "Provisioning a short-lived media path.";
  elements.liveLabel.classList.remove("live");
  elements.liveLabelText.textContent = "Starting";
  elements.timecode.textContent = "00:00:00";
  elements.viewerReadout.textContent = "0 joined";
  elements.stopButton.textContent = "End broadcast";
  elements.ingestStatus.textContent = "Provisioning";
  elements.ingestIce.textContent = "New";
  elements.ingestRoute.textContent = "Pending";
  elements.ingestFps.textContent = "0.0 fps";
  elements.ingestBytes.textContent = "0 B";
  elements.manifestStatus.textContent = "Offline";
  elements.trackerStatus.textContent = "Unpublished";
  setControlState("Creating");
  renderViewers();
}

async function startBroadcast() {
  if (state.running || state.stopping) {
    return;
  }
  if (elements.ingestMode.value === "rtmp" && state.runtime?.rtmpEnabled !== true) {
    setControlState("RTMP unavailable");
    telemetry.add({
      source: "adapter",
      code: "DISABLED",
      message: "RTMP ingest is disabled by this deployment",
      meta: "Choose Browser WHIP demo",
      error: true,
    });
    return;
  }
  resetRunState();
  setRunControls(true);
  try {
    const online = await probeNode({ quiet: true });
    if (!online) {
      throw new Error("Start HyperBEAM or correct the node URL, then try again.");
    }
    const created = await state.client.call("create", {
      "request-id": randomId("create"),
      "session-id": state.sessionId,
      "peer-id": state.owner.id,
      access: "open",
      metadata: sessionMetadata("starting"),
    });
    state.owner.generation = Number(created["peer-generation"]);
    state.owner.cursor = Number(created["current-cursor"] || 0);
    state.latestCursor = state.owner.cursor;
    state.running = true;
    updateSessionSnapshot(created);
    elements.ownerGeneration.textContent = String(state.owner.generation);
    elements.sessionStatus.textContent = "starting";
    setControlState("Media adapter starting");
    markProof("session");

    state.media = await provisionMediaSession();
    renderMediaCredentials();

    const runId = state.runId;
    void pollOwner(runId);
    addInterval(() => void heartbeatOwner(runId), 15_000);
    addInterval(() => void refreshSession(runId), 30_000);
    addInterval(() => void sampleWhipStats(runId), 1_000);
    addInterval(() => {
      elements.timecode.textContent = formatElapsed(performance.now() - state.startedAt);
    }, 250);

    if (elements.ingestMode.value === "browser") {
      await startBrowserIngest(runId);
    } else {
      elements.ingestStatus.textContent = "Waiting for RTMP";
      elements.sourceReadout.textContent = "External OBS / RTMP source";
      elements.liveLabelText.textContent = "Waiting for OBS";
      telemetry.add({
        source: "adapter",
        code: "RTMP",
        message: "RTMP media path provisioned",
        meta: "Copy the server and stream key; credentials are not logged",
      });
      void activatePlaybackWhenReady(runId);
    }
  } catch (error) {
    await handleFatal(error);
  }
}

async function provisionMediaSession() {
  const challenge = await requestMediaChallenge();
  await sendMediaAdmissionProof(challenge);
  await completeMediaChallenge(challenge);
  return waitForMediaCredentials(challenge, state.runId);
}

async function requestMediaChallenge() {
  const response = await fetch(state.runtime.mediaChallengeEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId: state.sessionId, publisherId: state.owner.id }),
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(ADAPTER_REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  const adapterGeneration = Number(body?.adapterGeneration);
  const expiresAt = expiryTime(body?.expiresAt);
  if (
    response.status !== 201 ||
    !validOpaqueValue(body?.challengeId, 256) ||
    !validOpaqueValue(body?.adapterPeerId, 256) ||
    !Number.isSafeInteger(adapterGeneration) ||
    adapterGeneration < 1 ||
    !validOpaqueValue(body?.connectionId, 256) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error(body?.error || `Media challenge returned HTTP ${response.status}.`);
  }
  telemetry.add({
    source: "adapter",
    code: "201",
    message: "Owner admission challenge issued",
    meta: "Awaiting owner-signed Hyperstream proof",
  });
  return {
    challengeId: body.challengeId,
    adapterPeerId: body.adapterPeerId,
    adapterGeneration,
    connectionId: body.connectionId,
    expiresAt,
  };
}

async function sendMediaAdmissionProof(challenge) {
  if (Date.now() >= challenge.expiresAt) {
    throw new Error("The media admission challenge expired before proof submission.");
  }
  const body = {
    protocol: PROTOCOL,
    "challenge-id": challenge.challengeId,
    "session-id": state.sessionId,
    "publisher-peer-id": state.owner.id,
    "publisher-generation": state.owner.generation,
    "adapter-peer-id": challenge.adapterPeerId,
    "adapter-generation": challenge.adapterGeneration,
  };
  const accepted = await state.client.call(
    "signal",
    {
      ...memberFields(state.sessionId, state.owner),
      "request-id": randomId("media-admission-proof"),
      "to-peer-id": challenge.adapterPeerId,
      "connection-id": challenge.connectionId,
      kind: "media-admission-proof",
      "content-type": "application/json",
      body,
    },
    { silent: true },
  );
  if (!accepted.duplicate) {
    state.signalCount += 1;
    elements.signalCount.textContent = String(state.signalCount);
  }
  telemetry.add({
    source: "owner",
    code: accepted.duplicate ? "DUP" : "202",
    message: "Media admission proof sent through Hyperstream",
    meta: `cursor ${accepted.cursor}`,
  });
}

async function completeMediaChallenge(challenge) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3 && Date.now() < challenge.expiresAt; attempt += 1) {
    let response;
    let body = {};
    try {
      response = await fetch(state.runtime.mediaSessionEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ challengeId: challenge.challengeId }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(ADAPTER_REQUEST_TIMEOUT_MS),
      });
      body = await response.json().catch(() => ({}));
      if (
        response.status === 202 &&
        body?.accepted === true &&
        !Object.keys(body && typeof body === "object" ? body : {}).some(
          (key) => key !== "accepted",
        )
      ) {
        telemetry.add({
          source: "adapter",
          code: "202",
          message: "Media allocation accepted",
          meta: "Credentials are returning over a targeted Hyperstream signal",
        });
        return;
      }
      lastError = new Error(body?.error || `Media admission returned HTTP ${response.status}.`);
      if (response.status < 500 && ![202, 409, 429].includes(response.status)) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
      if (response && response.status < 500 && ![202, 409, 429].includes(response.status)) {
        throw error;
      }
    }
    if (attempt < 3 && Date.now() < challenge.expiresAt) {
      await wait(200 * attempt);
    }
  }
  throw lastError || new Error("The media admission challenge expired before completion.");
}

async function waitForMediaCredentials(challenge, runId) {
  let consecutiveErrors = 0;
  while (runMatches(runId) && Date.now() < challenge.expiresAt) {
    let page;
    try {
      page = await state.client.call(
        "events",
        {
          ...memberFields(state.sessionId, state.owner),
          after: state.owner.cursor,
          limit: 100,
        },
        { silent: true },
      );
    } catch (error) {
      if (!runMatches(runId) || !retryableRequestError(error)) {
        throw error;
      }
      consecutiveErrors += 1;
      await wait(Math.min(1_000, 100 * 2 ** Math.min(consecutiveErrors, 3)));
      continue;
    }
    if (!runMatches(runId)) {
      throw new Error("The broadcast stopped during media admission.");
    }
    if (Date.now() >= challenge.expiresAt) {
      break;
    }
    for (const event of Array.isArray(page.events) ? page.events : []) {
      if (isMediaCredentialSignal(event, challenge)) {
        const media = mediaCredentialsFromSignal(event, challenge);
        advanceOwnerCursor(event.cursor);
        telemetry.add({
          source: "adapter",
          code: "SIGNAL",
          message: "Targeted media credentials accepted",
          meta: `g${challenge.adapterGeneration} · cursor ${event.cursor} · contents hidden`,
        });
        return media;
      }
      await handleOwnerEvent(event);
      advanceOwnerCursor(event.cursor);
      if (!runMatches(runId)) {
        throw new Error("The broadcast stopped during media admission.");
      }
    }
    advanceOwnerCursor(page["next-cursor"]);
    consecutiveErrors = 0;
    await wait(responseHasMore(page["has-more"]) ? 25 : 250);
  }
  throw new Error("Timed out waiting for targeted media credentials.");
}

function isMediaCredentialSignal(event, challenge) {
  return (
    event?.type === "signal" &&
    event.kind === "media-session" &&
    event["content-type"] === "application/json" &&
    event["from-peer-id"] === challenge.adapterPeerId &&
    Number(event["from-peer-generation"]) === challenge.adapterGeneration &&
    event["to-peer-id"] === state.owner.id &&
    event["connection-id"] === challenge.connectionId
  );
}

function mediaCredentialsFromSignal(event, challenge) {
  const body = event.body;
  if (
    body?.protocol !== PROTOCOL ||
    body["challenge-id"] !== challenge.challengeId ||
    body["session-id"] !== state.sessionId ||
    body["publisher-peer-id"] !== state.owner.id ||
    Number(body["publisher-generation"]) !== state.owner.generation
  ) {
    throw new Error("The media adapter returned a mismatched credential envelope.");
  }
  return validateMediaCredentials(body.media);
}

function validateMediaCredentials(media) {
  const streamEpoch = Number(media?.streamEpoch);
  const expiresAt = expiryTime(media?.expiresAt);
  if (
    !validOpaqueValue(media?.mediaId, 128) ||
    media.mediaId.includes("/") ||
    !validOpaqueValue(media.whipToken, 8_192) ||
    !validOpaqueValue(media.releaseToken, 8_192) ||
    !validOpaqueValue(media.swarmId, 512) ||
    !Number.isSafeInteger(streamEpoch) ||
    streamEpoch < 1 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error("The media adapter returned invalid credentials.");
  }
  const whipUrl = transportUrl(media.whipUrl, new Set(["http:", "https:"]));
  const manifestUrl = transportUrl(media.manifestUrl, new Set(["http:", "https:"]));
  const digestUrl = transportUrl(media.digestUrl, new Set(["http:", "https:"]));
  const trackerUrl = transportUrl(media.trackerUrl, new Set(["ws:", "wss:"]));
  if (new URL(digestUrl).origin !== window.location.origin) {
    throw new Error("The media digest endpoint must be same-origin.");
  }
  const value = {
    ...media,
    whipUrl,
    manifestUrl,
    digestUrl,
    trackerUrl,
    streamEpoch,
    expiresAt: new Date(expiresAt).toISOString(),
  };
  const hasRtmpServer = typeof media.rtmpServer === "string";
  const hasRtmpKey = typeof media.rtmpKey === "string";
  if (hasRtmpServer !== hasRtmpKey) {
    throw new Error("The media adapter returned incomplete RTMP credentials.");
  }
  if (hasRtmpServer) {
    if (!state.runtime.rtmpEnabled || !validOpaqueValue(media.rtmpKey, 8_192)) {
      throw new Error("The media adapter returned unexpected RTMP credentials.");
    }
    value.rtmpServer = transportUrl(media.rtmpServer, new Set(["rtmp:", "rtmps:"]));
  }
  if (elements.ingestMode.value === "rtmp" && (!value.rtmpServer || !value.rtmpKey)) {
    throw new Error("This media session did not provide RTMP ingest credentials.");
  }
  return value;
}

function validOpaqueValue(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function expiryTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

function transportUrl(value, protocols) {
  if (typeof value !== "string") {
    throw new Error("The media adapter returned an invalid transport URL.");
  }
  const url = new URL(value, window.location.href);
  if (!protocols.has(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("The media adapter returned an invalid transport URL.");
  }
  return url.href;
}

function advanceOwnerCursor(value) {
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < state.owner.cursor) {
    return;
  }
  state.owner.cursor = cursor;
  state.latestCursor = Math.max(state.latestCursor, cursor);
  elements.sessionCursor.textContent = String(state.latestCursor);
}

function renderMediaCredentials() {
  if (state.media.rtmpServer && state.media.rtmpKey) {
    elements.rtmpServer.value = state.media.rtmpServer;
    elements.rtmpKey.value = state.media.rtmpKey;
    elements.copyRtmpServer.disabled = false;
    elements.copyRtmpKey.disabled = false;
    elements.ingestHelp.textContent = `Short-lived until ${new Date(state.media.expiresAt).toLocaleTimeString()}.`;
  } else {
    elements.rtmpServer.value = "RTMP is not exposed by this deployment";
    elements.ingestHelp.textContent = "Browser WHIP ingest is available; RTMP is disabled here.";
  }
}

function sessionMetadata(status) {
  const metadata = {
    application: "hyperstream-broadcast-demo",
    protocol: PROTOCOL,
    role: "publisher",
    "publisher-peer-id": state.owner.id,
    topology: "https-origin-with-p2p-segments",
    status,
  };
  if (!state.media) {
    return metadata;
  }
  return {
    ...metadata,
    playback: {
      mode: "hls-cmaf",
      manifest: state.media.manifestUrl,
      fallback: "https",
      "swarm-id": state.media.swarmId,
      "stream-epoch": state.media.streamEpoch,
      trackers: [state.media.trackerUrl],
      "target-duration-ms": 2_000,
      integrity: {
        mode: "https-origin-sha256",
        endpoint: state.media.digestUrl,
      },
    },
    ingest: {
      protocols: ["whip", ...(state.media.rtmpServer ? ["rtmp"] : [])],
      media: "external",
    },
  };
}

async function releaseMediaSession() {
  if (!state.media?.mediaId || !state.media?.releaseToken) {
    return;
  }
  const endpoint = `${state.runtime.mediaSessionEndpoint}/${encodeURIComponent(state.media.mediaId)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${state.media.releaseToken}`,
        },
        cache: "no-store",
        credentials: "omit",
        keepalive: true,
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(ADAPTER_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
    }
    if (response?.ok) {
      return;
    }
    if (response) {
      lastError = new Error(`Media release returned HTTP ${response.status}.`);
      if (response.status < 500 && response.status !== 429) {
        throw lastError;
      }
    }
    if (attempt < 3) {
      await wait(200 * attempt);
    }
  }
  throw lastError || new Error("Media release could not be confirmed.");
}

async function startBrowserIngest(runId) {
  state.publisherStream = await capturePublisherMedia();
  state.publisher = new WhipPublisher({
    url: state.media.whipUrl,
    token: state.media.whipToken,
    stream: state.publisherStream,
    onState: renderWhipState,
  });
  elements.ingestStatus.textContent = "Negotiating";
  telemetry.add({
    source: "adapter",
    code: "WHIP",
    message: "Creating the single publisher uplink",
    meta: "H.264 preferred · offer body not logged",
  });
  await state.publisher.start();
  if (!runMatches(runId)) {
    return;
  }
  renderWhipState(state.publisher.state());
  markProof("ingest");
  telemetry.add({
    source: "adapter",
    code: "201",
    message: "WHIP ingest accepted",
    meta: "One publisher connection · resource URL hidden",
  });
  await activatePlaybackWhenReady(runId);
}

async function capturePublisherMedia() {
  const video = elements.publisherVideo;
  const capture = video.captureStream || video.mozCaptureStream;
  if (typeof capture !== "function") {
    throw new Error("This browser cannot capture the media-clocked demo source.");
  }
  await waitForPublisherVideo(video);
  video.currentTime = 0;
  await video.play();
  const stream = capture.call(video);
  let track;
  try {
    track = await waitForCapturedVideoTrack(stream);
  } catch (error) {
    stream.getTracks().forEach((capturedTrack) => capturedTrack.stop());
    video.pause();
    throw error;
  }
  if ("contentHint" in track) {
    track.contentHint = "motion";
  }
  elements.publisherCanvas.hidden = true;
  video.hidden = false;
  elements.sourceReadout.textContent = "1280 × 720 · 30 fps media-clocked source";
  telemetry.add({
    source: "media",
    code: "SOURCE",
    message: "Media-clocked publisher source started",
    meta: "H.264 loop · 1280 × 720 · 30 fps",
  });
  return stream;
}

function waitForPublisherVideo(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(new Error("Timed out loading the publisher source video.")),
      8_000,
    );
    const finish = (error) => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", handleLoaded);
      video.removeEventListener("error", handleError);
      error ? reject(error) : resolve();
    };
    const handleLoaded = () => finish();
    const handleError = () => finish(new Error("The publisher source video failed to load."));
    video.addEventListener("loadeddata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.load();
  });
}

function waitForCapturedVideoTrack(stream) {
  const [existing] = stream.getVideoTracks();
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(new Error("The source did not expose a captured video track.")),
      3_000,
    );
    const finish = (error, track) => {
      window.clearTimeout(timeout);
      stream.removeEventListener("addtrack", handleTrack);
      error ? reject(error) : resolve(track);
    };
    const handleTrack = ({ track }) => {
      if (track.kind === "video") {
        finish(null, track);
      }
    };
    stream.addEventListener("addtrack", handleTrack);
  });
}

async function activatePlaybackWhenReady(runId) {
  const started = Date.now();
  let attempt = 0;
  while (runMatches(runId) && Date.now() - started < MANIFEST_TIMEOUT_MS) {
    attempt += 1;
    try {
      const response = await fetch(state.media.manifestUrl, {
        headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain" },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(ADAPTER_REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();
      if (response.ok && body.startsWith("#EXTM3U")) {
        await publishPlaybackDescriptor(runId);
        return;
      }
    } catch {
    }
    elements.manifestStatus.textContent = `Waiting · ${attempt}`;
    await wait(Math.min(3_000, 500 + attempt * 250));
  }
  if (runMatches(runId)) {
    await handleFatal(new Error("The HLS manifest did not become available before timeout."));
  }
}

async function publishPlaybackDescriptor(runId) {
  if (!runMatches(runId) || state.playbackPublished) {
    return;
  }
  const updated = await state.client.call("update", {
    ...memberFields(state.sessionId, state.owner),
    metadata: sessionMetadata("live"),
  });
  if (!runMatches(runId)) {
    return;
  }
  state.playbackPublished = true;
  updateSessionSnapshot(updated);
  elements.sessionStatus.textContent = "live";
  elements.manifestStatus.textContent = "HTTPS live";
  elements.trackerStatus.textContent = "Private WSS published";
  elements.liveLabel.classList.add("live");
  elements.liveLabelText.textContent = "Broadcasting";
  if (!state.publisher) {
    elements.ingestStatus.textContent = "RTMP active";
    markProof("ingest");
  }
  markProof("manifest");
  createWatchUrl();
  setControlState("Hyperstream control active");
  telemetry.add({
    source: "owner",
    code: "UPDATE",
    message: "Playback descriptor published through Hyperstream",
    meta: "HTTPS fallback · private tracker · no credentials",
  });
}

function createWatchUrl() {
  const url = new URL("./watch.html", window.location.href);
  url.hash = `invite=${encodeInvite({
    endpoint: state.endpoint,
    sessionId: state.sessionId,
    publisherId: state.owner.id,
  })}`;
  state.watchUrl = url.href;
  elements.watchUrl.value = state.watchUrl;
  elements.copyButton.disabled = false;
  elements.openButton.disabled = false;
  elements.shareHelp.textContent = "Public descriptor only; publish credentials remain on this page.";
  telemetry.add({
    source: "session",
    code: "URL",
    message: "Public watch URL generated",
    meta: "fragment descriptor · no media or peer credentials",
  });
}

async function copyValue(value, button) {
  if (!value) {
    return;
  }
  await navigator.clipboard.writeText(value);
  const previous = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1_500);
}

function openWatchUrl() {
  if (state.watchUrl) {
    window.open(state.watchUrl, "_blank", "noopener,noreferrer");
  }
}

function updateSessionSnapshot(snapshot) {
  state.latestCursor = Math.max(state.latestCursor, Number(snapshot["current-cursor"] || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  elements.sessionStatus.textContent = snapshot["session-status"] || "live";
  const peers = Array.isArray(snapshot.peers) ? snapshot.peers : [];
  elements.sessionPeers.textContent = String(peers.length);
  state.serverPeers = new Map(peers.map((peer) => [peer["peer-id"], peer]));
  renderViewers();
}

async function pollOwner(runId) {
  let consecutiveErrors = 0;
  let firstErrorAt = 0;
  while (runMatches(runId)) {
    try {
      const page = await state.client.call(
        "events",
        {
          ...memberFields(state.sessionId, state.owner),
          after: state.owner.cursor,
          limit: 100,
        },
        { silent: true },
      );
      if (!runMatches(runId)) {
        return;
      }
      for (const event of Array.isArray(page.events) ? page.events : []) {
        await handleOwnerEvent(event);
        if (!runMatches(runId)) {
          return;
        }
      }
      state.owner.cursor = Number(page["next-cursor"] || state.owner.cursor);
      state.latestCursor = Math.max(state.latestCursor, Number(page["current-cursor"] || 0));
      elements.sessionCursor.textContent = String(state.latestCursor);
      consecutiveErrors = 0;
      firstErrorAt = 0;
      await wait(responseHasMore(page["has-more"]) ? 50 : 2_000);
    } catch (error) {
      if (!runMatches(runId)) {
        return;
      }
      if (
        error instanceof DeviceRequestError &&
        error.status === 410 &&
        error.reason === "cursor-expired"
      ) {
        try {
          await recoverOwnerCursor(runId);
          consecutiveErrors = 0;
          continue;
        } catch (recoveryError) {
          await handleFatal(recoveryError);
          return;
        }
      }
      consecutiveErrors += 1;
      firstErrorAt ||= Date.now();
      if (!retryableRequestError(error) || Date.now() - firstErrorAt >= 20_000) {
        await handleFatal(error);
        return;
      }
      await wait(Math.min(4_000, 500 * 2 ** Math.min(consecutiveErrors, 3)));
    }
  }
}

async function handleOwnerEvent(event) {
  state.latestCursor = Math.max(state.latestCursor, Number(event.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  if (event.type === "peer-joined") {
    const peer = event.peer;
    state.serverPeers.set(peer["peer-id"], peer);
    telemetry.add({
      source: "session",
      code: "JOIN",
      message: `${peer["peer-id"]} joined`,
      meta: `generation ${peer["peer-generation"]} · cursor ${event.cursor}`,
    });
    if (peer.metadata?.role === "viewer") {
      markProof("viewer");
    }
    renderViewers();
    return;
  }
  if (event.type === "peer-left") {
    state.serverPeers.delete(event["peer-id"]);
    for (const [key, viewer] of state.viewerStates) {
      if (viewer.peerId === event["peer-id"]) {
        state.viewerStates.delete(key);
      }
    }
    telemetry.add({
      source: "session",
      code: "LEAVE",
      message: `${event["peer-id"]} left`,
      meta: `${event.reason || "left"} · cursor ${event.cursor}`,
    });
    renderViewers();
    return;
  }
  if (event.type === "session-closed") {
    if (!state.stopping) {
      await finishBroadcast("Ended");
    }
    return;
  }
  if (event.type !== "signal") {
    telemetry.add({
      source: "session",
      code: "EVENT",
      message: event.type,
      meta: `cursor ${event.cursor}`,
    });
    return;
  }
  telemetry.add({
    source: "viewer",
    code: "SIGNAL",
    message: `${event.kind} from ${event["from-peer-id"]}`,
    meta: `g${event["from-peer-generation"]} · cursor ${event.cursor} · ${formatBytes(safeBodySize(event.body))}`,
  });
  if (event["to-peer-id"] !== state.owner.id || !validViewerBody(event)) {
    return;
  }
  const key = `${event["from-peer-id"]}:${event["from-peer-generation"]}`;
  const viewer = state.viewerStates.get(key) || {
    peerId: event["from-peer-id"],
    generation: Number(event["from-peer-generation"]),
    connectionId: event["connection-id"],
    delivery: "joining",
    p2p: false,
  };
  viewer.connectionId = event["connection-id"];
  if (event.kind === "watch-ready") {
    viewer.delivery = "descriptor acknowledged";
    state.viewerStates.set(key, viewer);
    await sendOwnerSignal(event, "playback-ack", {
      protocol: PROTOCOL,
      "publisher-peer-id": state.owner.id,
      "publisher-generation": state.owner.generation,
      "viewer-peer-id": viewer.peerId,
      "viewer-generation": viewer.generation,
      delivery: "hls-p2p",
      fallback: "https",
    });
  } else if (event.kind === "playback-active") {
    viewer.delivery = event.body.delivery === "p2p" ? "P2P + HTTPS" : "HTTPS fallback";
    viewer.p2p = event.body.delivery === "p2p";
    state.viewerStates.set(key, viewer);
    markProof("media");
  }
  renderViewers();
}

function validViewerBody(event) {
  const body = event.body;
  return (
    body?.protocol === PROTOCOL &&
    body["publisher-peer-id"] === state.owner.id &&
    Number(body["publisher-generation"]) === state.owner.generation &&
    body["viewer-peer-id"] === event["from-peer-id"] &&
    Number(body["viewer-generation"]) === Number(event["from-peer-generation"])
  );
}

async function sendOwnerSignal(event, kind, body) {
  const accepted = await state.client.call(
    "signal",
    {
      ...memberFields(state.sessionId, state.owner),
      "request-id": randomId(kind),
      "to-peer-id": event["from-peer-id"],
      "connection-id": event["connection-id"],
      kind,
      "content-type": "application/json",
      body,
    },
    { silent: true },
  );
  if (!accepted.duplicate) {
    state.signalCount += 1;
    elements.signalCount.textContent = String(state.signalCount);
  }
  telemetry.add({
    source: "publisher",
    code: accepted.duplicate ? "DUP" : "202",
    message: `${kind} → ${event["from-peer-id"]}`,
    meta: `cursor ${accepted.cursor} · ${formatBytes(safeBodySize(body))}`,
  });
}

async function heartbeatOwner(runId) {
  if (!runMatches(runId)) {
    return;
  }
  try {
    const reply = await state.client.call(
      "heartbeat",
      {
        ...memberFields(state.sessionId, state.owner),
        "ack-cursor": state.owner.cursor,
      },
      { silent: true },
    );
    if (!runMatches(runId)) {
      return;
    }
    state.heartbeatFailures = 0;
    state.latestCursor = Math.max(state.latestCursor, Number(reply["current-cursor"] || 0));
  } catch (error) {
    state.heartbeatFailures += 1;
    if (state.heartbeatFailures >= 3 && runMatches(runId)) {
      await handleFatal(error);
    }
  }
}

async function refreshSession(runId) {
  if (!runMatches(runId)) {
    return;
  }
  try {
    const snapshot = await state.client.call(
      "session",
      memberFields(state.sessionId, state.owner),
      { silent: true },
    );
    if (runMatches(runId)) {
      updateSessionSnapshot(snapshot);
    }
  } catch (error) {
    if (runMatches(runId) && !retryableRequestError(error)) {
      await handleFatal(error);
    }
  }
}

async function recoverOwnerCursor(runId) {
  const snapshot = await state.client.call(
    "session",
    memberFields(state.sessionId, state.owner),
    { silent: true },
  );
  if (!runMatches(runId)) {
    return;
  }
  updateSessionSnapshot(snapshot);
  state.owner.cursor = Number(snapshot["current-cursor"] || 0);
  telemetry.add({
    source: "owner",
    code: "RESYNC",
    message: "Expired event cursor resynchronized",
    meta: `cursor ${state.owner.cursor}`,
  });
}

function renderWhipState(value) {
  elements.ingestStatus.textContent = value.connectionState;
  elements.ingestIce.textContent = value.iceConnectionState;
  elements.connectionCount.textContent = value.resourceCreated ? "1 / 1" : "0 / 1";
  if (value.connectionState === "connected") {
    markProof("ingest");
  }
  if (value.connectionState === "failed" && state.running && !state.stopping) {
    void handleFatal(new Error("The WHIP publisher connection failed."));
  }
}

async function sampleWhipStats(runId) {
  if (!runMatches(runId) || !state.publisher) {
    return;
  }
  try {
    const stats = await state.publisher.stats();
    const now = performance.now();
    let effectiveFps = stats.framesPerSecond;
    if (state.previousWhipStats && now > state.previousWhipStats.sampledAt) {
      effectiveFps ||= Math.max(
        0,
        (stats.framesSent - state.previousWhipStats.framesSent) /
          ((now - state.previousWhipStats.sampledAt) / 1_000),
      );
    }
    state.previousWhipStats = { framesSent: stats.framesSent, sampledAt: now };
    elements.ingestRoute.textContent = stats.route;
    elements.ingestFps.textContent = `${effectiveFps.toFixed(1)} fps`;
    elements.ingestBytes.textContent = formatBytes(stats.bytesSent);
  } catch {
  }
}

function renderViewers() {
  const viewerPeers = Array.from(state.serverPeers.values()).filter(
    (peer) => peer.metadata?.role === "viewer",
  );
  const activeKeys = new Set();
  for (const peer of viewerPeers) {
    const key = `${peer["peer-id"]}:${peer["peer-generation"]}`;
    activeKeys.add(key);
    const viewer = state.viewerStates.get(key);
    let row = elements.viewerList.querySelector(`[data-viewer-key="${CSS.escape(key)}"]`);
    if (!row) {
      row = createViewerRow(key);
      elements.viewerList.append(row);
    }
    updateViewerRow(row, peer, viewer);
  }
  for (const row of elements.viewerList.querySelectorAll(".viewer-row")) {
    if (!activeKeys.has(row.dataset.viewerKey)) {
      row.remove();
    }
  }
  elements.viewerEmpty.hidden = viewerPeers.length > 0;
  elements.viewerCount.textContent = `${viewerPeers.length} active`;
  elements.viewerReadout.textContent = `${viewerPeers.length} joined`;
}

function createViewerRow(key) {
  const row = document.createElement("article");
  row.className = "viewer-row";
  row.dataset.viewerKey = key;
  const identity = document.createElement("div");
  identity.className = "viewer-identity";
  const dot = document.createElement("span");
  dot.className = "viewer-state-dot";
  const name = document.createElement("div");
  const title = document.createElement("b");
  title.dataset.field = "peer";
  const subtitle = document.createElement("span");
  subtitle.dataset.field = "generation";
  name.append(title, subtitle);
  identity.append(dot, name);
  const facts = document.createElement("dl");
  facts.className = "viewer-debug-grid";
  for (const field of ["Membership", "Control signal", "Delivery", "Media path"]) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = field;
    const detail = document.createElement("dd");
    detail.dataset.field = field.toLowerCase().replace(" ", "-");
    wrapper.append(term, detail);
    facts.append(wrapper);
  }
  row.append(identity, facts);
  return row;
}

function updateViewerRow(row, peer, viewer) {
  row.querySelector('[data-field="peer"]').textContent = peer["peer-id"];
  row.querySelector('[data-field="generation"]').textContent = `generation ${peer["peer-generation"]}`;
  row.querySelector('[data-field="membership"]').textContent = "active lease";
  row.querySelector('[data-field="control-signal"]').textContent = viewer?.connectionId || "waiting";
  row.querySelector('[data-field="delivery"]').textContent = viewer?.delivery || "joining";
  row.querySelector('[data-field="media-path"]').textContent = "HTTPS + optional P2P";
  row.dataset.state = viewer?.delivery?.includes("HTTPS") ? "connected" : "joined";
}

async function stopBroadcast() {
  if ((!state.running && !state.closeUnconfirmed) || state.stopping) {
    return;
  }
  state.stopping = true;
  elements.stopButton.disabled = true;
  elements.sessionStatus.textContent = "closing";
  setControlState("Closing");
  try {
    const closed = await state.client.call("close", memberFields(state.sessionId, state.owner));
    state.latestCursor = Math.max(state.latestCursor, Number(closed["current-cursor"] || 0));
    telemetry.add({
      source: "owner",
      code: "CLOSE",
      message: "Broadcast closed by owner",
      meta: `cursor ${state.latestCursor}`,
    });
    await finishBroadcast("Ended");
  } catch (error) {
    if (
      error instanceof DeviceRequestError &&
      error.status === 410 &&
      error.reason === "session-closed"
    ) {
      await finishBroadcast("Ended");
      return;
    }
    state.stopping = false;
    state.closeUnconfirmed = true;
    elements.stopButton.disabled = false;
    elements.stopButton.textContent = "Retry close";
    elements.sessionStatus.textContent = "close unconfirmed";
    telemetry.add({
      source: "owner",
      code: "UNCERTAIN",
      message: "Session close could not be confirmed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
  }
}

async function finishBroadcast(label) {
  state.runId += 1;
  state.running = false;
  state.stopping = false;
  state.closeUnconfirmed = false;
  clearIntervals();
  if (state.publisher) {
    await state.publisher.stop();
  } else {
    state.publisherStream?.getTracks().forEach((track) => track.stop());
  }
  try {
    await releaseMediaSession();
  } catch (error) {
    telemetry.add({
      source: "adapter",
      code: "UNCERTAIN",
      message: "Media adapter release could not be confirmed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
  }
  state.publisher = null;
  state.publisherStream = null;
  state.watchUrl = "";
  elements.copyButton.disabled = true;
  elements.openButton.disabled = true;
  elements.watchUrl.value = "Broadcast ended";
  elements.liveLabel.classList.remove("live");
  elements.liveLabelText.textContent = label;
  elements.stopButton.textContent = "End broadcast";
  elements.sessionStatus.textContent = label.toLowerCase();
  elements.viewerReadout.textContent = "0 joined";
  elements.ingestStatus.textContent = "closed";
  setControlState(label);
  setRunControls(false);
  void elements.publisherVideo.play().catch(() => {});
}

async function handleFatal(error) {
  if (state.fatalHandled) {
    return;
  }
  state.fatalHandled = true;
  telemetry.add({
    source: "broadcaster",
    code: "ERR",
    message: "Broadcast flow stopped",
    meta: error instanceof Error ? error.message : "unknown-error",
    error: true,
  });
  if (state.running && state.client && state.owner?.generation) {
    try {
      await state.client.call("close", memberFields(state.sessionId, state.owner), { silent: true });
    } catch {
    }
  }
  await finishBroadcast("Failed");
}

function runMatches(runId) {
  return state.running && !state.stopping && state.runId === runId;
}

function handleVisibilityChange() {
  if (!state.running || state.stopping || elements.ingestMode.value !== "browser") {
    return;
  }
  const hidden = document.visibilityState === "hidden";
  elements.sourceReadout.textContent = hidden
    ? "1280 × 720 · 30 fps media clock · background"
    : "1280 × 720 · 30 fps media-clocked source";
  telemetry.add({
    source: "media",
    code: hidden ? "HIDDEN" : "VISIBLE",
    message: hidden ? "Media-clocked source continues in background" : "Publisher tab is visible",
    meta: "HTML media capture",
  });
  if (elements.publisherVideo.paused) {
    void elements.publisherVideo.play().catch(() => {});
  }
}

async function initialize() {
  elements.startButton.disabled = true;
  try {
    await loadRuntimeConfig();
    await elements.publisherVideo.play().catch(() => {});
    await probeNode({ quiet: true });
  } catch (error) {
    setNodeState("error", "Initialization failed");
    telemetry.add({
      source: "demo",
      code: "ERR",
      message: "Runtime initialization failed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
  } finally {
    elements.startButton.disabled = false;
  }
}

elements.nodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void probeNode();
});
elements.startButton.addEventListener("click", () => void startBroadcast());
elements.stopButton.addEventListener("click", () => void stopBroadcast());
elements.copyButton.addEventListener("click", () => void copyValue(state.watchUrl, elements.copyButton));
elements.copyRtmpServer.addEventListener("click", () =>
  void copyValue(state.media?.rtmpServer, elements.copyRtmpServer),
);
elements.copyRtmpKey.addEventListener("click", () =>
  void copyValue(state.media?.rtmpKey, elements.copyRtmpKey),
);
elements.openButton.addEventListener("click", openWatchUrl);
elements.clearButton.addEventListener("click", () => telemetry.reset());
document.addEventListener("visibilitychange", handleVisibilityChange);

Object.defineProperty(window, "__hyperstreamBroadcaster", {
  value: Object.freeze({
    diagnostics: () =>
      Object.freeze({
        active: state.running && !state.stopping,
        sessionId: state.sessionId,
        publisherPeerId: state.owner?.id || null,
        publisherGeneration: state.owner?.generation || 0,
        cursor: state.latestCursor,
        serverPeerCount: state.serverPeers.size,
        requestCount: state.requestCount,
        signalCount: state.signalCount,
        playbackPublished: state.playbackPublished,
        ingestMode: elements.ingestMode.value,
        whip: state.publisher?.state() || null,
      }),
  }),
  configurable: false,
  enumerable: false,
  writable: false,
});

void initialize();
