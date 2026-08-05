import { createHybridPlayer } from "./hybrid-player.js";
import {
  DeviceRequestError,
  HyperstreamClient,
  Telemetry,
  createPeer,
  decodeInvite,
  formatBytes,
  formatElapsed,
  memberFields,
  membershipLost,
  peerConnectionConfiguration,
  randomId,
  responseHasMore,
  retryableRequestError,
  safeBodySize,
  wait,
} from "./shared.js";

const PROTOCOL = "hyperstream-hls-p2p@1";

const elements = {
  headerSession: document.querySelector("#header-session"),
  nodeDot: document.querySelector("#node-dot"),
  nodeStatus: document.querySelector("#node-status"),
  playButton: document.querySelector("#play-button"),
  retryButton: document.querySelector("#retry-button"),
  leaveButton: document.querySelector("#leave-button"),
  viewerVideo: document.querySelector("#viewer-video"),
  standby: document.querySelector("#standby"),
  standbyTitle: document.querySelector("#standby-title"),
  standbyDetail: document.querySelector("#standby-detail"),
  liveLabel: document.querySelector("#live-label"),
  liveLabelText: document.querySelector("#live-label-text"),
  timecode: document.querySelector("#timecode"),
  videoReadout: document.querySelector("#video-readout"),
  connectionReadout: document.querySelector("#connection-readout"),
  iceReadout: document.querySelector("#ice-readout"),
  viewerStatus: document.querySelector("#viewer-status"),
  viewerNode: document.querySelector("#viewer-node"),
  sessionId: document.querySelector("#session-id"),
  viewerPeer: document.querySelector("#viewer-peer"),
  viewerGeneration: document.querySelector("#viewer-generation"),
  publisherPeer: document.querySelector("#publisher-peer"),
  connectionId: document.querySelector("#connection-id"),
  sessionCursor: document.querySelector("#session-cursor"),
  signalingState: document.querySelector("#signaling-state"),
  gatheringState: document.querySelector("#gathering-state"),
  iceRoute: document.querySelector("#ice-route"),
  roundTripTime: document.querySelector("#round-trip-time"),
  videoDimensions: document.querySelector("#video-dimensions"),
  framesDecoded: document.querySelector("#frames-decoded"),
  frameRate: document.querySelector("#frame-rate"),
  bytesReceived: document.querySelector("#bytes-received"),
  packetsReceived: document.querySelector("#packets-received"),
  packetsLost: document.querySelector("#packets-lost"),
  jitter: document.querySelector("#jitter"),
  peerCount: document.querySelector("#peer-count"),
  bufferDepth: document.querySelector("#buffer-depth"),
  segmentCount: document.querySelector("#segment-count"),
  originFallbackCount: document.querySelector("#origin-fallback-count"),
  requestCount: document.querySelector("#request-count"),
  signalCount: document.querySelector("#signal-count"),
  foreignSignalCount: document.querySelector("#foreign-signal-count"),
  cachePolicy: document.querySelector("#cache-policy"),
  eventLog: document.querySelector("#event-log"),
  eventEmpty: document.querySelector("#event-empty"),
  clearButton: document.querySelector("#clear-button"),
};

const telemetry = new Telemetry(elements.eventLog, elements.eventEmpty);

const state = {
  invite: null,
  descriptor: null,
  client: null,
  peer: null,
  publisherGeneration: 0,
  connectionId: null,
  player: null,
  running: false,
  stopping: false,
  memberActive: false,
  runId: 0,
  intervals: new Set(),
  sendChain: Promise.resolve(),
  latestCursor: 0,
  requestCount: 0,
  signalCount: 0,
  foreignSignalCount: 0,
  startedAt: 0,
  heartbeatFailures: 0,
  fatalHandled: false,
  playbackActiveSent: false,
  p2pActiveSent: false,
  previousFrames: 0,
  previousFrameSampleAt: 0,
  frameRate: 0,
  latestStats: null,
  integrity: createIntegrityState(),
};

function createIntegrityState() {
  return {
    checked: 0,
    accepted: 0,
    rejected: 0,
    p2p: { checked: 0, accepted: 0, rejected: 0 },
    http: { checked: 0, accepted: 0, rejected: 0 },
    lastFailure: null,
    lastSuccess: null,
  };
}

function setNodeState(mode, text) {
  elements.nodeDot.classList.remove("online", "error");
  if (mode) {
    elements.nodeDot.classList.add(mode);
  }
  elements.nodeStatus.textContent = text;
}

function setViewerStatus(status) {
  elements.viewerStatus.textContent = status;
  elements.liveLabelText.textContent = status;
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

function resetJoinState() {
  state.runId += 1;
  clearIntervals();
  state.player?.destroy();
  state.player = null;
  state.descriptor = null;
  state.peer = createPeer("viewer", "viewer");
  state.publisherGeneration = 0;
  state.connectionId = randomId("playback");
  state.running = false;
  state.stopping = false;
  state.memberActive = false;
  state.sendChain = Promise.resolve();
  state.latestCursor = 0;
  state.requestCount = 0;
  state.signalCount = 0;
  state.foreignSignalCount = 0;
  state.startedAt = performance.now();
  state.heartbeatFailures = 0;
  state.fatalHandled = false;
  state.playbackActiveSent = false;
  state.p2pActiveSent = false;
  state.previousFrames = 0;
  state.previousFrameSampleAt = 0;
  state.frameRate = 0;
  state.latestStats = null;
  state.integrity = createIntegrityState();
  telemetry.reset();

  elements.playButton.hidden = true;
  elements.retryButton.hidden = true;
  elements.leaveButton.disabled = true;
  elements.viewerVideo.classList.remove("ready");
  elements.standby.classList.remove("hidden");
  elements.standbyTitle.textContent = "Joining Hyperstream session";
  elements.standbyDetail.textContent =
    "The viewer is registering a signed member and resolving the owner-published playback descriptor.";
  elements.liveLabel.classList.remove("live");
  elements.timecode.textContent = "00:00:00";
  elements.videoReadout.textContent = "Waiting for manifest";
  elements.connectionReadout.textContent = "HTTPS fallback";
  elements.iceReadout.textContent = "0 peers";
  elements.viewerPeer.textContent = state.peer.id;
  elements.viewerGeneration.textContent = "0";
  elements.publisherPeer.textContent = state.invite.publisherId;
  elements.connectionId.textContent = "pending";
  elements.sessionCursor.textContent = "0";
  elements.signalingState.textContent = "pending";
  elements.gatheringState.textContent = "pending";
  elements.iceRoute.textContent = "HTTPS fallback";
  elements.roundTripTime.textContent = "0.0 s";
  elements.videoDimensions.textContent = "0 × 0";
  elements.framesDecoded.textContent = "0";
  elements.frameRate.textContent = "0.0 fps";
  elements.bytesReceived.textContent = "0 B";
  elements.packetsReceived.textContent = "0 B";
  elements.packetsLost.textContent = "0 B";
  elements.jitter.textContent = "0.0%";
  elements.peerCount.textContent = "0";
  elements.bufferDepth.textContent = "0.0 s";
  elements.segmentCount.textContent = "0";
  elements.originFallbackCount.textContent = "0";
  elements.requestCount.textContent = "0";
  elements.signalCount.textContent = "0";
  elements.foreignSignalCount.textContent = "0";
  elements.cachePolicy.textContent = "Unproven";
  setViewerStatus("Joining");
}

async function joinStream() {
  if (state.running || state.stopping) {
    return;
  }
  resetJoinState();
  setNodeState("", "Probing");
  try {
    state.client = new HyperstreamClient(state.invite.endpoint, onDeviceRequest);
    const latency = await state.client.probe();
    setNodeState("online", `Online · ${latency} ms`);
    telemetry.add({
      source: "node",
      code: "OK",
      message: "HyperBEAM metadata route responded",
      meta: `${latency} ms`,
    });
    const joined = await state.client.call("join", {
      "request-id": randomId("join-viewer"),
      "session-id": state.invite.sessionId,
      "peer-id": state.peer.id,
      metadata: {
        role: "viewer",
        client: "hyperstream-watch",
        protocol: PROTOCOL,
        delivery: "https-with-optional-p2p",
      },
    });
    state.peer.generation = Number(joined["peer-generation"]);
    state.peer.cursor = Number(joined["current-cursor"] || 0);
    state.latestCursor = state.peer.cursor;
    state.memberActive = true;
    const descriptor = parseSessionDescriptor(joined);
    state.publisherGeneration = findPublisherGeneration(joined);
    if (!state.publisherGeneration) {
      throw new Error("The publisher peer is not active in this session.");
    }
    state.descriptor = descriptor;
    state.running = true;
    renderDescriptor();
    elements.leaveButton.disabled = false;
    elements.viewerGeneration.textContent = String(state.peer.generation);
    elements.sessionCursor.textContent = String(state.latestCursor);
    setViewerStatus("Joined");
    telemetry.add({
      source: "viewer",
      code: "JOIN",
      message: `${state.peer.id} joined`,
      meta: `generation ${state.peer.generation} · cursor ${state.peer.cursor}`,
    });

    const runId = state.runId;
    const segmentValidator = createSegmentValidator(descriptor, runId);
    const observeHttpsSegment = (details) => {
      void segmentValidator(details);
      return true;
    };
    state.player = await createHybridPlayer(elements.viewerVideo, {
      manifestUrl: descriptor.manifestUrl,
      trackerUrls: descriptor.trackerUrls,
      swarmId: descriptor.swarmId,
      validateP2PSegment: segmentValidator,
      validateHTTPSegment: observeHttpsSegment,
      iceServers: peerConnectionConfiguration().iceServers,
      p2pEnabled: true,
      p2pUploadEnabled: true,
      p2pMaxPeers: 8,
      onEvent: (event) => handlePlayerEvent(runId, event),
      onStats: (stats) => renderPlayerStats(runId, stats),
    });
    if (!runMatches(runId)) {
      state.player?.destroy();
      return;
    }
    void pollViewer(runId);
    addInterval(() => void heartbeatViewer(runId), 15_000);
    addInterval(() => updateTimecode(), 250);
    await queueSignal("watch-ready", fencedBody({
      delivery: "hls-p2p",
      fallback: "https",
    }));
    elements.standbyTitle.textContent = "Viewer joined";
    elements.standbyDetail.textContent =
      "The HLS player is starting from HTTPS while the private tracker discovers optional peers.";
  } catch (error) {
    await handleFatal(error);
  }
}

function parseSessionDescriptor(snapshot) {
  const metadata = snapshot?.metadata;
  const playback = metadata?.playback;
  if (
    metadata?.protocol !== PROTOCOL ||
    metadata["publisher-peer-id"] !== state.invite.publisherId ||
    metadata.status !== "live" ||
    playback?.mode !== "hls-cmaf" ||
    playback.fallback !== "https" ||
    playback.integrity?.mode !== "https-origin-sha256" ||
    typeof playback.integrity?.endpoint !== "string" ||
    typeof playback.manifest !== "string" ||
    typeof playback["swarm-id"] !== "string" ||
    !Array.isArray(playback.trackers) ||
    playback.trackers.length < 1 ||
    playback.trackers.length > 4 ||
    !Number.isInteger(Number(playback["stream-epoch"]))
  ) {
    throw new Error("The owner-controlled session metadata has no valid live playback descriptor.");
  }
  const digestUrl = new URL(playback.integrity.endpoint, window.location.href);
  if (digestUrl.origin !== window.location.origin || digestUrl.username || digestUrl.password || digestUrl.hash) {
    throw new Error("The playback integrity endpoint must be credential-free and same-origin.");
  }
  return {
    manifestUrl: playback.manifest,
    digestUrl: digestUrl.href,
    trackerUrls: playback.trackers,
    swarmId: playback["swarm-id"],
    streamEpoch: Number(playback["stream-epoch"]),
  };
}

function recordSegmentValidation(runId, source, segment, accepted, reason, startedAt) {
  if (!runMatches(runId)) {
    return accepted;
  }
  const normalizedSource = source === "p2p" ? "p2p" : "http";
  const durationMs = Math.round(performance.now() - startedAt);
  const entry = {
    source: normalizedSource,
    segment,
    reason,
    durationMs,
    at: Date.now(),
  };
  state.integrity.checked += 1;
  state.integrity[normalizedSource].checked += 1;
  if (accepted) {
    state.integrity.accepted += 1;
    state.integrity[normalizedSource].accepted += 1;
    state.integrity.lastSuccess = entry;
    return true;
  }
  state.integrity.rejected += 1;
  state.integrity[normalizedSource].rejected += 1;
  state.integrity.lastFailure = entry;
  if (normalizedSource === "p2p") {
    telemetry.add({
      source: "p2p",
      code: "VERIFY",
      message: "Peer segment rejected; HTTPS fallback remains active",
      meta: `${reason} · ${segment || "unknown segment"} · ${durationMs} ms`,
      error: true,
    });
  }
  return false;
}

function createSegmentValidator(descriptor, runId) {
  const manifestBase = new URL(".", descriptor.manifestUrl);
  const digestSessionId = crypto.randomUUID();
  return async ({ url, byteRange, data, source }) => {
    const startedAt = performance.now();
    let segment = null;
    const finish = (accepted, reason) =>
      recordSegmentValidation(runId, source, segment, accepted, reason, startedAt);
    try {
      const segmentUrl = new URL(url, manifestBase);
      if (
        segmentUrl.origin !== manifestBase.origin ||
        !segmentUrl.pathname.startsWith(manifestBase.pathname) ||
        segmentUrl.hash
      ) {
        return finish(false, "invalid-origin");
      }
      const sessionValues = segmentUrl.searchParams.getAll("session");
      if (
        Array.from(segmentUrl.searchParams.keys()).some((key) => key !== "session") ||
        sessionValues.length > 1 ||
        (sessionValues.length === 1 && !/^[0-9a-f-]{16,64}$/i.test(sessionValues[0]))
      ) {
        return finish(false, "invalid-query");
      }
      segment = decodeURIComponent(segmentUrl.pathname.slice(manifestBase.pathname.length));
      if (!segment || segment.startsWith("/") || segment.includes("..")) {
        return finish(false, "invalid-segment");
      }
      const digestUrl = new URL(descriptor.digestUrl);
      digestUrl.searchParams.set("segment", segment);
      digestUrl.searchParams.set("session", sessionValues[0] || digestSessionId);
      if (byteRange) {
        return finish(false, "byte-range-unsupported");
      }
      const response = await fetch(digestUrl, {
        headers: { Accept: "application/json" },
        cache: "default",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) {
        return finish(false, `digest-status-${response.status}`);
      }
      let expected;
      try {
        expected = await response.json();
      } catch {
        return finish(false, "digest-json-invalid");
      }
      if (!Number.isSafeInteger(Number(expected.bytes)) || typeof expected.sha256 !== "string") {
        return finish(false, "digest-metadata-invalid");
      }
      if (Number(expected.bytes) !== data.byteLength) {
        return finish(false, "digest-size-mismatch");
      }
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      let binary = "";
      for (const byte of hash) {
        binary += String.fromCharCode(byte);
      }
      const actual = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return finish(actual === expected.sha256, actual === expected.sha256 ? "verified" : "digest-hash-mismatch");
    } catch (error) {
      return finish(false, error?.name === "TimeoutError" ? "digest-timeout" : "digest-unavailable");
    }
  };
}

function findPublisherGeneration(snapshot) {
  const peers = Array.isArray(snapshot?.peers) ? snapshot.peers : [];
  const publisher = peers.find((peer) => peer["peer-id"] === state.invite.publisherId);
  return Number(publisher?.["peer-generation"] || 0);
}

function renderDescriptor() {
  elements.connectionId.textContent = shortValue(state.descriptor.swarmId, 22);
  elements.signalingState.textContent = new URL(state.descriptor.trackerUrls[0]).host;
  elements.gatheringState.textContent = "Hls.js + P2P loader";
  telemetry.add({
    source: "session",
    code: "META",
    message: "Owner-published playback descriptor accepted",
    meta: `epoch ${state.descriptor.streamEpoch} · HTTPS fallback · SHA-256 peer validation`,
  });
}

function handlePlayerEvent(runId, event) {
  if (!runMatches(runId)) {
    return;
  }
  if (event.type === "mode") {
    elements.gatheringState.textContent = event.mode;
    elements.signalingState.textContent = event.trackerCount ? "connecting" : "not used";
    telemetry.add({
      source: "player",
      code: "MODE",
      message: `Delivery engine: ${event.mode}`,
      meta: event.trackerCount ? `${event.trackerCount} private tracker` : event.reason,
    });
    return;
  }
  if (event.type === "manifest") {
    elements.videoReadout.textContent = "Manifest loaded";
    telemetry.add({
      source: "origin",
      code: "HLS",
      message: "HTTPS manifest parsed",
      meta: `${event.levels} rendition${event.levels === 1 ? "" : "s"}`,
    });
    return;
  }
  if (event.type === "playlist") {
    telemetry.add({
      source: "origin",
      code: event.live ? "LIVE" : "VOD",
      message: "HLS media playlist updated",
      meta: `${event.segmentCount} segments · target ${event.targetDuration.toFixed(1)} s`,
    });
    return;
  }
  if (event.type === "peer-connect") {
    elements.signalingState.textContent = "tracker connected";
    telemetry.add({
      source: "p2p",
      code: "PEER",
      message: "Viewer data-channel peer connected",
      meta: `${shortValue(event.peerId, 12)} · ${event.peerCount} active`,
    });
    return;
  }
  if (event.type === "peer-close") {
    telemetry.add({
      source: "p2p",
      code: "CLOSE",
      message: "Viewer data-channel peer closed",
      meta: `${shortValue(event.peerId, 12)} · ${event.peerCount} active`,
    });
    return;
  }
  if (event.type === "segment") {
    telemetry.add({
      source: event.source === "p2p" ? "p2p" : "origin",
      code: event.source === "p2p" ? "P2P" : "HTTPS",
      message: `HLS segment ${event.externalId ?? "loaded"}`,
      meta: `${formatBytes(event.bytes)}${event.peerId ? ` · peer ${shortValue(event.peerId, 10)}` : ""}`,
    });
    return;
  }
  if (event.type === "tracker-error" || event.type === "tracker-warning") {
    elements.signalingState.textContent = "unavailable · HTTPS active";
    telemetry.add({
      source: "p2p",
      code: "FALLBACK",
      message: "Tracker unavailable; playback remains on HTTPS",
      meta: event.error?.message || event.warning?.message || "tracker error",
      error: true,
    });
    return;
  }
  if (event.type === "peer-error") {
    telemetry.add({
      source: "p2p",
      code: "PEER",
      message: `Viewer peer ${event.phase || "connection"} error`,
      meta: event.error?.message || "peer error",
      error: true,
    });
    return;
  }
  if (event.type === "p2p-fallback" || event.type === "p2p-disabled") {
    elements.signalingState.textContent = "HTTPS only";
    telemetry.add({
      source: "player",
      code: "FALLBACK",
      message: "P2P unavailable; continuing over HTTPS",
      meta: event.reason,
    });
    return;
  }
  if (event.type === "segment-error") {
    telemetry.add({
      source: "player",
      code: "SEGMENT",
      message: "Segment request failed and will be retried",
      meta: event.error?.message || "segment error",
      error: true,
    });
    return;
  }
  if (event.type === "hls-error" && event.fatal) {
    telemetry.add({
      source: "player",
      code: "HLS",
      message: "Fatal HLS engine error",
      meta: event.details,
      error: true,
    });
    return;
  }
  if (event.type === "recovery-scheduled") {
    elements.videoReadout.textContent = "Recovering playback";
    setViewerStatus("Recovering");
    telemetry.add({
      source: "player",
      code: "RETRY",
      message: `Playback recovery ${event.attempt} of ${event.maxAttempts}`,
      meta: `${event.details} · retry in ${(event.delayMs / 1_000).toFixed(1)} s`,
      error: true,
    });
    return;
  }
  if (event.type === "recovery-error") {
    telemetry.add({
      source: "player",
      code: "RETRY",
      message: "Playback restart failed",
      meta: event.error?.message || event.details,
      error: true,
    });
    return;
  }
  if (event.type === "recovery-stable") {
    telemetry.add({
      source: "player",
      code: "STABLE",
      message: "Playback recovery budget reset",
      meta: "30 seconds of continuous playback",
    });
    return;
  }
  if (event.type === "player-fatal") {
    telemetry.add({
      source: "player",
      code: "FATAL",
      message: "Playback recovery exhausted",
      meta: `${event.details} · ${event.attempts} attempts`,
      error: true,
    });
    void handleFatal(new Error(`Playback failed after ${event.attempts} recovery attempts.`));
    return;
  }
  if (event.type === "playback-error") {
    elements.playButton.hidden = false;
    setViewerStatus("Playback blocked");
    return;
  }
  if (event.type === "media") {
    handleMediaState(event.state);
  }
}

function handleMediaState(mediaState) {
  if (mediaState === "playing") {
    elements.playButton.hidden = true;
    elements.standby.classList.add("hidden");
    elements.viewerVideo.classList.add("ready");
    elements.liveLabel.classList.add("live");
    elements.videoReadout.textContent = "Live playback";
    setViewerStatus("Live");
    void announcePlayback("https");
    return;
  }
  if (mediaState === "waiting" || mediaState === "stalled") {
    setViewerStatus("Buffering");
    elements.videoReadout.textContent = "Buffering";
    return;
  }
  if (mediaState === "pause" && state.running) {
    setViewerStatus("Paused");
  }
}

function renderPlayerStats(runId, stats) {
  if (!runMatches(runId)) {
    return;
  }
  state.latestStats = stats;
  const now = performance.now();
  const elapsed = state.previousFrameSampleAt ? (now - state.previousFrameSampleAt) / 1_000 : 0;
  if (!state.previousFrameSampleAt || elapsed >= 0.75) {
    state.frameRate = elapsed > 0
      ? Math.max(0, stats.decodedFrames - state.previousFrames) / elapsed
      : 0;
    state.previousFrames = stats.decodedFrames;
    state.previousFrameSampleAt = now;
  }
  const p2pActive = stats.peerCount > 0 && stats.p2pBytes > 0;
  elements.connectionReadout.textContent = p2pActive ? "P2P + HTTPS" : "HTTPS fallback";
  elements.iceReadout.textContent = `${stats.peerCount} peer${stats.peerCount === 1 ? "" : "s"}`;
  elements.iceRoute.textContent = p2pActive ? "P2P + HTTPS" : "HTTPS fallback";
  elements.roundTripTime.textContent = stats.liveLatencySeconds == null
    ? "pending"
    : `${stats.liveLatencySeconds.toFixed(1)} s`;
  elements.videoDimensions.textContent = `${stats.videoWidth} × ${stats.videoHeight}`;
  elements.framesDecoded.textContent = String(stats.decodedFrames);
  elements.frameRate.textContent = `${state.frameRate.toFixed(1)} fps`;
  elements.bytesReceived.textContent = formatBytes(stats.httpBytes);
  elements.packetsReceived.textContent = formatBytes(stats.p2pBytes);
  elements.packetsLost.textContent = formatBytes(stats.p2pUploadBytes);
  elements.jitter.textContent = `${(stats.p2pRatio * 100).toFixed(1)}%`;
  elements.peerCount.textContent = String(stats.peerCount);
  elements.bufferDepth.textContent = `${stats.bufferSeconds.toFixed(1)} s`;
  elements.segmentCount.textContent = String(stats.segments.total);
  elements.originFallbackCount.textContent = String(stats.segments.http);
  if (p2pActive) {
    void announcePlayback("p2p");
  }
}

async function announcePlayback(delivery) {
  if (!state.running || state.stopping) {
    return;
  }
  if (delivery === "https" && state.playbackActiveSent) {
    return;
  }
  if (delivery === "p2p" && state.p2pActiveSent) {
    return;
  }
  if (delivery === "https") {
    state.playbackActiveSent = true;
  } else {
    state.p2pActiveSent = true;
  }
  try {
    await queueSignal("playback-active", fencedBody({
      delivery,
      fallback: "https",
    }));
  } catch (error) {
    telemetry.add({
      source: "viewer",
      code: "SIGNAL",
      message: "Playback status signal failed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
  }
}

function fencedBody(values = {}) {
  return {
    protocol: PROTOCOL,
    "publisher-peer-id": state.invite.publisherId,
    "publisher-generation": state.publisherGeneration,
    "viewer-peer-id": state.peer.id,
    "viewer-generation": state.peer.generation,
    ...values,
  };
}

function bodyMatchesViewer(body) {
  return (
    body?.protocol === PROTOCOL &&
    body["publisher-peer-id"] === state.invite.publisherId &&
    Number(body["publisher-generation"]) === state.publisherGeneration &&
    body["viewer-peer-id"] === state.peer.id &&
    Number(body["viewer-generation"]) === state.peer.generation
  );
}

function queueSignal(kind, body, requestId = randomId(kind)) {
  const previous = state.sendChain;
  const next = previous.then(() => sendViewerSignal(kind, body, requestId));
  state.sendChain = next.catch(() => {});
  return next;
}

async function sendViewerSignal(kind, body, requestId) {
  const accepted = await state.client.call(
    "signal",
    {
      ...memberFields(state.invite.sessionId, state.peer),
      "request-id": requestId,
      "to-peer-id": state.invite.publisherId,
      "connection-id": state.connectionId,
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
  state.latestCursor = Math.max(state.latestCursor, Number(accepted.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  telemetry.add({
    source: "viewer",
    code: accepted.duplicate ? "DUP" : "202",
    message: `${kind} → ${state.invite.publisherId}`,
    meta: `cursor ${accepted.cursor} · ${formatBytes(safeBodySize(body))}`,
  });
  return accepted;
}

async function pollViewer(runId) {
  let consecutiveErrors = 0;
  let firstErrorAt = 0;
  const peer = state.peer;
  while (runMatches(runId, peer)) {
    try {
      const page = await state.client.call(
        "events",
        {
          ...memberFields(state.invite.sessionId, peer),
          after: peer.cursor,
          limit: 100,
        },
        { silent: true },
      );
      if (!runMatches(runId, peer)) {
        return;
      }
      for (const event of Array.isArray(page.events) ? page.events : []) {
        await handleViewerEvent(runId, event);
        if (!runMatches(runId, peer)) {
          return;
        }
      }
      peer.cursor = Number(page["next-cursor"] || peer.cursor);
      state.latestCursor = Math.max(state.latestCursor, Number(page["current-cursor"] || 0));
      elements.sessionCursor.textContent = String(state.latestCursor);
      consecutiveErrors = 0;
      firstErrorAt = 0;
      await wait(responseHasMore(page["has-more"]) ? 50 : 10_000);
    } catch (error) {
      if (!runMatches(runId, peer)) {
        return;
      }
      if (membershipLost(error)) {
        await handleFatal(new Error("Viewer membership expired; retry to rejoin."));
        return;
      }
      if (
        error instanceof DeviceRequestError &&
        error.status === 410 &&
        error.reason === "session-closed"
      ) {
        finishViewer("Ended", "The Hyperstream session has closed.", true, true);
        return;
      }
      if (
        error instanceof DeviceRequestError &&
        error.status === 410 &&
        error.reason === "cursor-expired"
      ) {
        try {
          await recoverViewerCursor(runId);
          consecutiveErrors = 0;
          continue;
        } catch (recoveryError) {
          await handleFatal(recoveryError);
          return;
        }
      }
      consecutiveErrors += 1;
      firstErrorAt ||= Date.now();
      if (!retryableRequestError(error) || Date.now() - firstErrorAt >= 25_000) {
        await handleFatal(error);
        return;
      }
      await wait(Math.min(5_000, 750 * 2 ** Math.min(consecutiveErrors, 3)));
    }
  }
}

async function handleViewerEvent(runId, event) {
  state.latestCursor = Math.max(state.latestCursor, Number(event.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  if (event.type === "session-closed") {
    finishViewer("Ended", "The broadcaster closed the Hyperstream session.", true, true);
    return;
  }
  if (event.type === "peer-left") {
    telemetry.add({
      source: "session",
      code: "LEAVE",
      message: `${event["peer-id"]} left`,
      meta: `${event.reason || "left"} · cursor ${event.cursor}`,
    });
    if (event["peer-id"] === state.invite.publisherId) {
      finishViewer("Ended", "The publisher left the session.", true, true);
    }
    return;
  }
  if (event.type === "session-updated") {
    await refreshDescriptor(runId);
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
  if (
    event["to-peer-id"] !== state.peer.id ||
    event["from-peer-id"] !== state.invite.publisherId ||
    Number(event["from-peer-generation"]) !== state.publisherGeneration ||
    event["connection-id"] !== state.connectionId ||
    !bodyMatchesViewer(event.body)
  ) {
    state.foreignSignalCount += 1;
    elements.foreignSignalCount.textContent = String(state.foreignSignalCount);
    return;
  }
  telemetry.add({
    source: "publisher",
    code: "SIGNAL",
    message: `${event.kind} from ${event["from-peer-id"]}`,
    meta: `cursor ${event.cursor} · ${formatBytes(safeBodySize(event.body))}`,
  });
  if (event.kind === "playback-ack") {
    elements.videoReadout.textContent = elements.viewerVideo.paused
      ? "Descriptor acknowledged"
      : "Live playback";
  }
}

async function refreshDescriptor(runId) {
  const snapshot = await state.client.call(
    "session",
    memberFields(state.invite.sessionId, state.peer),
    { silent: true },
  );
  if (!runMatches(runId)) {
    return;
  }
  const descriptor = parseSessionDescriptor(snapshot);
  if (
    descriptor.manifestUrl !== state.descriptor.manifestUrl ||
    descriptor.swarmId !== state.descriptor.swarmId
  ) {
    throw new Error("The live playback epoch changed; retry to join the new swarm safely.");
  }
  state.latestCursor = Math.max(state.latestCursor, Number(snapshot["current-cursor"] || 0));
  telemetry.add({
    source: "session",
    code: "UPDATE",
    message: "Session metadata refresh verified",
    meta: `epoch ${descriptor.streamEpoch} · cursor ${state.latestCursor}`,
  });
}

async function recoverViewerCursor(runId) {
  const snapshot = await state.client.call(
    "session",
    memberFields(state.invite.sessionId, state.peer),
    { silent: true },
  );
  if (!runMatches(runId)) {
    return;
  }
  parseSessionDescriptor(snapshot);
  state.peer.cursor = Number(snapshot["current-cursor"] || 0);
  state.latestCursor = state.peer.cursor;
  telemetry.add({
    source: "viewer",
    code: "RESYNC",
    message: "Expired event cursor resynchronized",
    meta: `cursor ${state.peer.cursor}`,
  });
}

async function heartbeatViewer(runId) {
  if (!runMatches(runId)) {
    return;
  }
  try {
    const reply = await state.client.call(
      "heartbeat",
      {
        ...memberFields(state.invite.sessionId, state.peer),
        "ack-cursor": state.peer.cursor,
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

async function attemptVideoPlayback() {
  if (state.player && (await state.player.play())) {
    elements.playButton.hidden = true;
  }
}

function updateTimecode() {
  const milliseconds = Number.isFinite(elements.viewerVideo.currentTime)
    ? elements.viewerVideo.currentTime * 1_000
    : 0;
  elements.timecode.textContent = formatElapsed(milliseconds);
}

async function leaveStream() {
  if (!state.running || state.stopping) {
    return;
  }
  state.stopping = true;
  elements.leaveButton.disabled = true;
  try {
    await releaseCurrentMembership();
  } catch (error) {
    telemetry.add({
      source: "viewer",
      code: "ERR",
      message: "Leave could not be confirmed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
  }
  finishViewer("Left", "You left the Hyperstream session.", true, true);
}

async function releaseCurrentMembership() {
  if (!state.memberActive || !state.client || !state.peer?.generation) {
    return;
  }
  try {
    await state.client.call(
      "leave",
      memberFields(state.invite.sessionId, state.peer),
      { silent: true },
    );
  } catch (error) {
    if (!(error instanceof DeviceRequestError && [404, 410].includes(error.status))) {
      throw error;
    }
  }
  state.memberActive = false;
}

async function retryJoin() {
  if (state.memberActive && !state.stopping) {
    await releaseCurrentMembership().catch(() => {});
  }
  finishViewer("Retrying", "Rejoining with a fresh peer generation.", false, true);
  await joinStream();
}

async function handleFatal(error) {
  if (state.fatalHandled) {
    return;
  }
  state.fatalHandled = true;
  telemetry.add({
    source: "viewer",
    code: "ERR",
    message: "Viewer flow stopped",
    meta: error instanceof Error ? error.message : "unknown-error",
    error: true,
  });
  await releaseCurrentMembership().catch(() => {});
  finishViewer("Failed", error instanceof Error ? error.message : "Viewer failed.", true, true);
}

function finishViewer(label, detail, retryable, membershipEnded = false) {
  state.runId += 1;
  state.running = false;
  state.stopping = false;
  state.memberActive = membershipEnded ? false : state.memberActive;
  clearIntervals();
  state.player?.destroy();
  state.player = null;
  elements.leaveButton.disabled = true;
  elements.retryButton.hidden = !retryable;
  elements.playButton.hidden = true;
  elements.viewerVideo.classList.remove("ready");
  elements.standby.classList.remove("hidden");
  elements.standbyTitle.textContent = label;
  elements.standbyDetail.textContent = detail;
  elements.liveLabel.classList.remove("live");
  setViewerStatus(label);
}

function runMatches(runId, peer = state.peer) {
  return state.running && !state.stopping && state.runId === runId && state.peer === peer;
}

function shortValue(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function initializeInvite() {
  try {
    state.invite = decodeInvite(window.location.hash);
    elements.headerSession.textContent = state.invite.sessionId;
    elements.viewerNode.textContent = state.invite.endpoint;
    elements.sessionId.textContent = state.invite.sessionId;
    elements.publisherPeer.textContent = state.invite.publisherId;
    void joinStream();
  } catch (error) {
    setNodeState("error", "Invalid invite");
    elements.headerSession.textContent = "Invalid invite";
    elements.retryButton.hidden = true;
    elements.standbyTitle.textContent = "Watch URL rejected";
    elements.standbyDetail.textContent = error instanceof Error ? error.message : "Invalid invite.";
    setViewerStatus("Invalid invite");
  }
}

elements.playButton.addEventListener("click", () => void attemptVideoPlayback());
elements.retryButton.addEventListener("click", () => void retryJoin());
elements.leaveButton.addEventListener("click", () => void leaveStream());
elements.clearButton.addEventListener("click", () => telemetry.reset());

Object.defineProperty(window, "__hyperstreamViewer", {
  value: Object.freeze({
    diagnostics: () =>
      Object.freeze({
        active: state.running && !state.stopping,
        sessionId: state.invite?.sessionId || null,
        viewerPeerId: state.peer?.id || null,
        viewerGeneration: state.peer?.generation || 0,
        publisherPeerId: state.invite?.publisherId || null,
        publisherGeneration: state.publisherGeneration,
        cursor: state.latestCursor,
        requestCount: state.requestCount,
        signalCount: state.signalCount,
        foreignSignalCount: state.foreignSignalCount,
        descriptor: state.descriptor
          ? {
              ...state.descriptor,
              trackerUrls: state.descriptor.trackerUrls.map((value) => {
                const url = new URL(value);
                url.search = "";
                return url.href;
              }),
            }
          : null,
        integrity: {
          ...state.integrity,
          p2p: { ...state.integrity.p2p },
          http: { ...state.integrity.http },
          lastFailure: state.integrity.lastFailure ? { ...state.integrity.lastFailure } : null,
          lastSuccess: state.integrity.lastSuccess ? { ...state.integrity.lastSuccess } : null,
        },
        player: state.player?.getStats() || state.latestStats,
      }),
  }),
  configurable: false,
  enumerable: false,
  writable: false,
});

initializeInvite();
