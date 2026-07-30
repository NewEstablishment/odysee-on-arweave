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
  peerConnectionConfiguration,
  randomId,
  responseHasMore,
  retryableRequestError,
  safeBodySize,
  selectedCandidateRoute,
  validIceCandidate,
  validSessionDescription,
  wait,
} from "./shared.js";

const MAX_VIEWERS = 8;
const MAX_NEGOTIATIONS_PER_MINUTE = 4;

const elements = {
  nodeForm: document.querySelector("#node-form"),
  nodeUrl: document.querySelector("#node-url"),
  probeButton: document.querySelector("#probe-button"),
  nodeDot: document.querySelector("#node-dot"),
  nodeStatus: document.querySelector("#node-status"),
  startButton: document.querySelector("#start-button"),
  stopButton: document.querySelector("#stop-button"),
  publisherCanvas: document.querySelector("#publisher-canvas"),
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
  eventLog: document.querySelector("#event-log"),
  eventEmpty: document.querySelector("#event-empty"),
  clearButton: document.querySelector("#clear-button"),
};

const telemetry = new Telemetry(elements.eventLog, elements.eventEmpty);

const state = {
  client: null,
  endpoint: "",
  running: false,
  stopping: false,
  runId: 0,
  sessionId: null,
  owner: null,
  watchUrl: "",
  canvasStream: null,
  viewers: new Map(),
  serverPeers: new Map(),
  intervals: new Set(),
  proofs: new Set(),
  requestCount: 0,
  signalCount: 0,
  latestCursor: 0,
  startedAt: 0,
  fatalHandled: false,
  negotiationBudget: new Map(),
  closeUnconfirmed: false,
  heartbeatFailures: 0,
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
  state.sessionId = `broadcast-${crypto.randomUUID().slice(0, 20)}`;
  state.owner = createPeer("publisher", "publisher");
  state.watchUrl = "";
  state.canvasStream = null;
  state.viewers = new Map();
  state.serverPeers = new Map();
  state.proofs = new Set();
  state.requestCount = 0;
  state.signalCount = 0;
  state.latestCursor = 0;
  state.startedAt = performance.now();
  state.fatalHandled = false;
  state.negotiationBudget = new Map();
  state.closeUnconfirmed = false;
  state.heartbeatFailures = 0;
  clearIntervals();
  telemetry.reset();
  resetProofs();

  elements.requestCount.textContent = "0";
  elements.signalCount.textContent = "0";
  elements.connectionCount.textContent = `0 / ${MAX_VIEWERS}`;
  elements.cachePolicy.textContent = "Unproven";
  elements.sessionStatus.textContent = "Starting";
  elements.sessionId.textContent = state.sessionId;
  elements.ownerPeer.textContent = state.owner.id;
  elements.ownerGeneration.textContent = "0";
  elements.sessionCursor.textContent = "0";
  elements.sessionPeers.textContent = "0";
  elements.watchUrl.value = "Creating session";
  elements.copyButton.disabled = true;
  elements.openButton.disabled = true;
  elements.shareHelp.textContent = "Creating the Hyperstream session and public watch locator.";
  elements.liveLabel.classList.remove("live");
  elements.liveLabelText.textContent = "Starting";
  elements.timecode.textContent = "00:00:00";
  elements.viewerReadout.textContent = "0 connected";
  elements.stopButton.textContent = "End broadcast";
  setControlState("Creating");
  renderViewers();
}

async function startBroadcast() {
  if (state.running || state.stopping) {
    return;
  }
  resetRunState();
  setRunControls(true);

  try {
    const online = await probeNode({ quiet: true });
    if (!online) {
      throw new Error("Start HyperBEAM or correct the node URL, then try again.");
    }

    state.canvasStream = elements.publisherCanvas.captureStream(30);
    const created = await state.client.call("create", {
      "request-id": randomId("create"),
      "session-id": state.sessionId,
      "peer-id": state.owner.id,
      access: "open",
      metadata: {
        application: "hyperstream-broadcast-demo",
        protocol: "hyperstream-webrtc-demo@1",
        role: "publisher",
        "publisher-peer-id": state.owner.id,
        topology: "publisher-to-viewer",
        media: "video",
        "max-viewers": MAX_VIEWERS,
      },
    });

    state.owner.generation = Number(created["peer-generation"]);
    state.owner.cursor = Number(created["current-cursor"] || 0);
    state.latestCursor = state.owner.cursor;
    state.running = true;

    updateSessionSnapshot(created);
    elements.ownerGeneration.textContent = String(state.owner.generation);
    elements.sessionStatus.textContent = "live";
    elements.liveLabel.classList.add("live");
    elements.liveLabelText.textContent = "Broadcasting";
    setControlState("Polling events");
    markProof("session");
    createWatchUrl();

    const runId = state.runId;
    void pollOwner(runId);
    addInterval(() => void heartbeatOwner(runId), 10_000);
    addInterval(() => void refreshSession(runId), 3_000);
    addInterval(() => void sampleViewerStats(runId), 1_000);
    addInterval(() => {
      elements.timecode.textContent = formatElapsed(performance.now() - state.startedAt);
    }, 250);
  } catch (error) {
    await handleFatal(error);
  }
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
  elements.shareHelp.textContent =
    "Public viewer locator. Loopback node addresses work only on this machine.";
  markProof("invite");
  telemetry.add({
    source: "session",
    code: "URL",
    message: "Public watch URL generated",
    meta: "fragment descriptor · no peer credentials",
  });
}

async function copyWatchUrl() {
  if (!state.watchUrl) {
    return;
  }
  await navigator.clipboard.writeText(state.watchUrl);
  const previous = elements.copyButton.textContent;
  elements.copyButton.textContent = "Copied";
  window.setTimeout(() => {
    elements.copyButton.textContent = previous;
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
  while (state.running && !state.stopping && state.runId === runId) {
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
      if (!state.running || state.stopping || state.runId !== runId) {
        return;
      }
      const events = Array.isArray(page.events) ? page.events : [];
      for (const event of events) {
        await handleOwnerEvent(event);
        if (!state.running || state.stopping || state.runId !== runId) {
          return;
        }
      }
      state.owner.cursor = Number(page["next-cursor"] || state.owner.cursor);
      state.latestCursor = Math.max(state.latestCursor, Number(page["current-cursor"] || 0));
      elements.sessionCursor.textContent = String(state.latestCursor);
      consecutiveErrors = 0;
      firstErrorAt = 0;
      await wait(responseHasMore(page["has-more"]) ? 40 : 300);
    } catch (error) {
      if (!state.running || state.stopping || state.runId !== runId) {
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
      const retryable = retryableRequestError(error);
      if (!retryable || Date.now() - firstErrorAt >= 20_000) {
        await handleFatal(error);
        return;
      }
      await wait(Math.min(3_000, 400 * 2 ** Math.min(consecutiveErrors, 3)));
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
    telemetry.add({
      source: "session",
      code: "LEAVE",
      message: `${event["peer-id"]} left`,
      meta: `${event.reason || "left"} · cursor ${event.cursor}`,
    });
    await reconcilePeer(event["peer-id"]);
    return;
  }

  if (event.type === "session-closed") {
    telemetry.add({
      source: "session",
      code: "CLOSE",
      message: "Broadcast session closed",
      meta: `${event.reason || "closed"} · cursor ${event.cursor}`,
    });
    if (!state.stopping) {
      teardown("Ended");
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

  if (event["to-peer-id"] !== state.owner.id) {
    return;
  }

  if (event.kind === "watch-ready") {
    try {
      await negotiateViewer(event);
    } catch (error) {
      handleViewerFailure(event["connection-id"], event["from-peer-id"], error);
    }
    return;
  }

  const slot = state.viewers.get(event["connection-id"]);
  if (!slot || !signalMatchesSlot(slot, event)) {
    telemetry.add({
      source: "publisher",
      code: "IGNORE",
      message: `${event.kind} did not match an active viewer connection`,
      meta: event["connection-id"],
    });
    return;
  }

  try {
    if (event.kind === "answer") {
      await acceptAnswer(slot, event.body);
    } else if (event.kind === "ice") {
      await acceptViewerIce(slot, event.body);
    }
  } catch (error) {
    handleViewerFailure(slot.connectionId, slot.peerId, error);
  }
}

function signalMatchesSlot(slot, event) {
  return (
    event["from-peer-id"] === slot.peerId &&
    Number(event["from-peer-generation"]) === slot.generation &&
    event["connection-id"] === slot.connectionId
  );
}

function bodyMatchesSlot(slot, body) {
  return (
    body?.protocol === "hyperstream-webrtc-demo@1" &&
    body["publisher-peer-id"] === state.owner.id &&
    Number(body["publisher-generation"]) === state.owner.generation &&
    body["viewer-peer-id"] === slot.peerId &&
    Number(body["viewer-generation"]) === slot.generation
  );
}

async function negotiateViewer(event) {
  const body = event.body;
  const peerId = event["from-peer-id"];
  const generation = Number(event["from-peer-generation"]);
  if (
    body?.protocol !== "hyperstream-webrtc-demo@1" ||
    body["publisher-peer-id"] !== state.owner.id ||
    Number(body["publisher-generation"]) !== state.owner.generation ||
    body["viewer-peer-id"] !== peerId ||
    Number(body["viewer-generation"]) !== generation
  ) {
    telemetry.add({
      source: "publisher",
      code: "FENCE",
      message: "Rejected an unfenced watch-ready signal",
      meta: `${peerId} · g${generation}`,
      error: true,
    });
    return;
  }

  const connectionId = event["connection-id"];
  const existing = state.viewers.get(connectionId);
  if (existing?.peerId === peerId && existing.generation === generation) {
    return;
  }
  const rejection = negotiationRejection(peerId, generation);
  if (rejection) {
    await rejectViewer(event, rejection);
    return;
  }

  closeViewerSlots(peerId);
  const pc = new RTCPeerConnection(peerConnectionConfiguration());
  const slot = {
    peerId,
    generation,
    connectionId,
    pc,
    sendChain: Promise.resolve(),
    outboundReady: false,
    outboundIce: [],
    inboundIce: [],
    offerDelivered: false,
    answerDelivered: false,
    stats: {
      bytesSent: 0,
      packetsSent: 0,
      framesEncoded: 0,
      route: "pending",
      roundTripTime: 0,
    },
    runId: state.runId,
  };
  state.viewers.set(connectionId, slot);

  for (const track of state.canvasStream.getTracks()) {
    pc.addTrack(track, state.canvasStream);
  }
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      queuePublisherIce(slot, candidate);
    }
  };
  pc.onconnectionstatechange = () => {
    renderViewers();
    updateConnectedMetrics();
    if (pc.connectionState === "failed") {
      handleViewerFailure(
        slot.connectionId,
        slot.peerId,
        new Error("The viewer peer connection failed."),
      );
    }
  };
  pc.oniceconnectionstatechange = renderViewers;
  pc.onsignalingstatechange = renderViewers;

  renderViewers();
  setControlState("Negotiating viewers");
  const offer = await pc.createOffer();
  if (!slotIsActive(slot)) {
    return;
  }
  await pc.setLocalDescription(offer);
  if (!slotIsActive(slot)) {
    return;
  }
  const requestId = randomId("offer");
  const offerBody = fencedBody(slot, {
    description: {
      type: pc.localDescription.type,
      sdp: pc.localDescription.sdp,
    },
  });
  const first = await queueSlotSignal(slot, "offer", offerBody, requestId);
  if (!slotIsActive(slot)) {
    return;
  }
  const duplicate = await queueSlotSignal(slot, "offer", offerBody, requestId);
  if (!slotIsActive(slot)) {
    return;
  }
  if (!duplicate.duplicate || Number(duplicate.cursor) !== Number(first.cursor)) {
    throw new Error("The offer idempotency retry did not reuse its cursor.");
  }
  slot.offerDelivered = true;
  telemetry.add({
    source: "publisher",
    code: "IDEM",
    message: `Offer retry deduplicated for ${slot.peerId}`,
    meta: `cursor ${duplicate.cursor}`,
  });
  await flushPublisherIce(slot);
  renderViewers();
}

function fencedBody(slot, values) {
  return {
    protocol: "hyperstream-webrtc-demo@1",
    "publisher-peer-id": state.owner.id,
    "publisher-generation": state.owner.generation,
    "viewer-peer-id": slot.peerId,
    "viewer-generation": slot.generation,
    ...values,
  };
}

function queueSlotSignal(slot, kind, body, requestId = randomId(kind)) {
  const previous = slot.sendChain;
  const next = previous.then(() => sendSlotSignal(slot, kind, body, requestId));
  slot.sendChain = next.catch(() => {});
  return next;
}

async function sendSlotSignal(slot, kind, body, requestId) {
  const accepted = await state.client.call(
    "signal",
    {
      ...memberFields(state.sessionId, state.owner),
      "request-id": requestId,
      "to-peer-id": slot.peerId,
      "connection-id": slot.connectionId,
      kind,
      "content-type": "application/json",
      body,
    },
    { silent: true },
  );
  if (!slotIsActive(slot)) {
    return accepted;
  }
  state.latestCursor = Math.max(state.latestCursor, Number(accepted.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  if (!accepted.duplicate) {
    state.signalCount += 1;
    elements.signalCount.textContent = String(state.signalCount);
  }
  telemetry.add({
    source: "publisher",
    code: accepted.duplicate ? "DUP" : "202",
    message: `${kind} → ${slot.peerId}`,
    meta: `g${slot.generation} · cursor ${accepted.cursor} · ${formatBytes(safeBodySize(body))}`,
  });
  return accepted;
}

function queuePublisherIce(slot, candidate) {
  if (!slotIsActive(slot)) {
    return;
  }
  const value = candidate.toJSON
    ? candidate.toJSON()
    : {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      };
  if (!slot.outboundReady) {
    slot.outboundIce.push(value);
    return;
  }
  void queueSlotSignal(slot, "ice", fencedBody(slot, { ice: value })).catch((error) => {
    handleViewerFailure(slot.connectionId, slot.peerId, error);
  });
}

async function flushPublisherIce(slot) {
  if (!slotIsActive(slot)) {
    return;
  }
  slot.outboundReady = true;
  const queued = slot.outboundIce.splice(0);
  for (const ice of queued) {
    await queueSlotSignal(slot, "ice", fencedBody(slot, { ice }));
  }
}

async function acceptAnswer(slot, body) {
  if (
    !bodyMatchesSlot(slot, body) ||
    !validSessionDescription(body.description, "answer")
  ) {
    throw new Error("Invalid or unfenced WebRTC answer.");
  }
  await slot.pc.setRemoteDescription(body.description);
  if (!slotIsActive(slot)) {
    return;
  }
  for (const ice of slot.inboundIce.splice(0)) {
    await slot.pc.addIceCandidate(ice);
  }
  slot.answerDelivered = true;
  markProof("signaling");
  renderViewers();
}

async function acceptViewerIce(slot, body) {
  if (!bodyMatchesSlot(slot, body) || !validIceCandidate(body.ice)) {
    throw new Error("Invalid or unfenced viewer ICE candidate.");
  }
  if (!slotIsActive(slot)) {
    return;
  }
  if (!slot.pc.remoteDescription) {
    slot.inboundIce.push(body.ice);
  } else {
    await slot.pc.addIceCandidate(body.ice);
  }
}

function negotiationRejection(peerId, generation) {
  const alreadyActive = Array.from(state.viewers.values()).some(
    (slot) => slot.peerId === peerId && slot.generation === generation,
  );
  if (!alreadyActive && state.viewers.size >= MAX_VIEWERS) {
    return "broadcaster-capacity";
  }

  const now = Date.now();
  const key = `${peerId}:${generation}`;
  const current = state.negotiationBudget.get(key);
  const budget =
    !current || now - current.windowStartedAt >= 60_000
      ? { count: 0, windowStartedAt: now }
      : current;
  budget.count += 1;
  state.negotiationBudget.set(key, budget);
  return budget.count > MAX_NEGOTIATIONS_PER_MINUTE ? "negotiation-rate-limit" : null;
}

async function rejectViewer(event, reason) {
  const peerId = event["from-peer-id"];
  const generation = Number(event["from-peer-generation"]);
  const body = {
    protocol: "hyperstream-webrtc-demo@1",
    "publisher-peer-id": state.owner.id,
    "publisher-generation": state.owner.generation,
    "viewer-peer-id": peerId,
    "viewer-generation": generation,
    reason,
  };
  try {
    const accepted = await state.client.call(
      "signal",
      {
        ...memberFields(state.sessionId, state.owner),
        "request-id": randomId("reject"),
        "to-peer-id": peerId,
        "connection-id": event["connection-id"],
        kind: "watch-rejected",
        "content-type": "application/json",
        body,
      },
      { silent: true },
    );
    state.latestCursor = Math.max(state.latestCursor, Number(accepted.cursor || 0));
    elements.sessionCursor.textContent = String(state.latestCursor);
    if (!accepted.duplicate) {
      state.signalCount += 1;
      elements.signalCount.textContent = String(state.signalCount);
    }
  } catch (error) {
    telemetry.add({
      source: "publisher",
      code: "REJECT",
      message: `Viewer rejection could not reach ${peerId}`,
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
    return;
  }
  telemetry.add({
    source: "publisher",
    code: "REJECT",
    message: `${peerId} was not admitted to a media connection`,
    meta: reason,
  });
}

async function heartbeatOwner(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  try {
    await state.client.call(
      "heartbeat",
      {
        ...memberFields(state.sessionId, state.owner),
        "ack-cursor": state.owner.cursor,
      },
      { silent: true },
    );
    if (state.running && !state.stopping && state.runId === runId) {
      state.heartbeatFailures = 0;
    }
  } catch (error) {
    if (state.running && !state.stopping && state.runId === runId) {
      state.heartbeatFailures += 1;
      if (!retryableRequestError(error) || state.heartbeatFailures >= 3) {
        await handleFatal(error);
      }
    }
  }
}

async function refreshSession(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return null;
  }
  try {
    const snapshot = await state.client.call(
      "session",
      memberFields(state.sessionId, state.owner),
      { silent: true },
    );
    if (!state.running || state.stopping || state.runId !== runId) {
      return null;
    }
    updateSessionSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (state.running && !state.stopping && state.runId === runId) {
      if (!retryableRequestError(error)) {
        await handleFatal(error);
      }
    }
    return null;
  }
}

async function recoverOwnerCursor(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  const snapshot = await state.client.call(
    "session",
    memberFields(state.sessionId, state.owner),
    { silent: true },
  );
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  updateSessionSnapshot(snapshot);
  state.owner.cursor = Number(snapshot["current-cursor"] || 0);
  state.latestCursor = Math.max(state.latestCursor, state.owner.cursor);
  elements.sessionCursor.textContent = String(state.latestCursor);
  telemetry.add({
    source: "owner",
    code: "RESYNC",
    message: "Expired event cursor refreshed from session state",
    meta: `cursor ${state.owner.cursor}`,
  });

  const viewers = Array.isArray(snapshot.peers)
    ? snapshot.peers.filter((peer) => peer.metadata?.role === "viewer")
    : [];
  for (const peer of viewers) {
    try {
      await sendResyncRequired(peer);
    } catch (error) {
      telemetry.add({
        source: "publisher",
        code: "RESYNC",
        message: `Could not request a fresh negotiation from ${peer["peer-id"]}`,
        meta: error instanceof Error ? error.message : "unknown-error",
        error: true,
      });
    }
  }
  for (const connectionId of Array.from(state.viewers.keys())) {
    closeViewerSlot(connectionId);
  }
}

async function sendResyncRequired(peer) {
  const peerId = peer["peer-id"];
  const generation = Number(peer["peer-generation"]);
  const body = {
    protocol: "hyperstream-webrtc-demo@1",
    "publisher-peer-id": state.owner.id,
    "publisher-generation": state.owner.generation,
    "viewer-peer-id": peerId,
    "viewer-generation": generation,
    reason: "cursor-expired",
  };
  const accepted = await state.client.call(
    "signal",
    {
      ...memberFields(state.sessionId, state.owner),
      "request-id": randomId("resync"),
      "to-peer-id": peerId,
      "connection-id": randomId("resync"),
      kind: "resync-required",
      "content-type": "application/json",
      body,
    },
    { silent: true },
  );
  state.latestCursor = Math.max(state.latestCursor, Number(accepted.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  if (!accepted.duplicate) {
    state.signalCount += 1;
    elements.signalCount.textContent = String(state.signalCount);
  }
  telemetry.add({
    source: "publisher",
    code: "RESYNC",
    message: `Fresh negotiation requested from ${peerId}`,
    meta: `g${generation} · cursor ${accepted.cursor}`,
  });
}

function handleViewerFailure(connectionId, peerId, error) {
  const slot = state.viewers.get(connectionId);
  if (!slot || slot.peerId !== peerId || slot.runId !== state.runId) {
    return;
  }
  telemetry.add({
    source: "publisher",
    code: "PEER",
    message: `Viewer negotiation stopped for ${peerId}`,
    meta: error instanceof Error ? error.message : "unknown-error",
    error: true,
  });
  closeViewerSlot(connectionId);
}

function slotIsActive(slot) {
  return (
    state.running &&
    !state.stopping &&
    slot.runId === state.runId &&
    state.viewers.get(slot.connectionId) === slot
  );
}

async function reconcilePeer(peerId) {
  const snapshot = await state.client.call(
    "session",
    memberFields(state.sessionId, state.owner),
    { silent: true },
  );
  updateSessionSnapshot(snapshot);
  const current = state.serverPeers.get(peerId);
  for (const [connectionId, slot] of state.viewers) {
    if (
      slot.peerId === peerId &&
      (!current || Number(current["peer-generation"]) !== slot.generation)
    ) {
      closeViewerSlot(connectionId);
    }
  }
  renderViewers();
}

async function sampleViewerStats(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  for (const slot of state.viewers.values()) {
    try {
      const reports = await slot.pc.getStats();
      if (
        !state.running ||
        state.stopping ||
        state.runId !== runId ||
        !slotIsActive(slot)
      ) {
        continue;
      }
      reports.forEach((report) => {
        const video =
          report.type === "outbound-rtp" &&
          !report.isRemote &&
          (report.kind === "video" || report.mediaType === "video");
        if (video) {
          slot.stats.bytesSent = Number(report.bytesSent || 0);
          slot.stats.packetsSent = Number(report.packetsSent || 0);
          slot.stats.framesEncoded = Number(report.framesEncoded || report.framesSent || 0);
        }
      });
      const route = selectedCandidateRoute(reports);
      if (route) {
        const changed = route.label !== slot.stats.route;
        slot.stats.route = route.label;
        slot.stats.roundTripTime = route.roundTripTime;
        if (changed) {
          telemetry.add({
            source: "webrtc",
            code: "ROUTE",
            message: `Selected ICE route for ${slot.peerId}`,
            meta: route.label,
          });
        }
      }
      if (
        slot.pc.connectionState === "connected" &&
        slot.stats.bytesSent > 0 &&
        slot.stats.framesEncoded > 0
      ) {
        markProof("media");
      }
    } catch {
      slot.stats.error = true;
    }
  }
  renderViewers();
  updateConnectedMetrics();
}

function updateConnectedMetrics() {
  const connected = Array.from(state.viewers.values()).filter(
    (slot) => slot.pc.connectionState === "connected",
  ).length;
  elements.viewerReadout.textContent = `${connected} connected`;
  elements.viewerCount.textContent = `${connected} active`;
  elements.connectionCount.textContent = `${state.viewers.size} / ${MAX_VIEWERS}`;
  setControlState(connected > 0 ? "Targeted signals active" : "Awaiting viewers");
}

function renderViewers() {
  elements.viewerList.querySelectorAll(".viewer-row").forEach((row) => row.remove());
  const viewerPeers = Array.from(state.serverPeers.values()).filter(
    (peer) => peer.metadata?.role === "viewer",
  );
  elements.viewerEmpty.hidden = viewerPeers.length > 0 || state.viewers.size > 0;

  const seen = new Set();
  for (const peer of viewerPeers) {
    const peerId = peer["peer-id"];
    const generation = Number(peer["peer-generation"]);
    const slot = Array.from(state.viewers.values()).find(
      (candidate) => candidate.peerId === peerId && candidate.generation === generation,
    );
    elements.viewerList.append(createViewerRow(peerId, generation, slot));
    seen.add(`${peerId}:${generation}`);
  }

  for (const slot of state.viewers.values()) {
    if (!seen.has(`${slot.peerId}:${slot.generation}`)) {
      elements.viewerList.append(createViewerRow(slot.peerId, slot.generation, slot));
    }
  }
  updateConnectedMetrics();
}

function createViewerRow(peerId, generation, slot) {
  const row = document.createElement("article");
  row.className = "viewer-row";
  const stateLabel = slot?.pc.connectionState || "joined";
  row.dataset.state = stateLabel;

  const identity = document.createElement("div");
  identity.className = "viewer-identity";
  const dot = document.createElement("span");
  dot.className = "viewer-state-dot";
  const name = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = peerId;
  const subtitle = document.createElement("span");
  subtitle.textContent = `generation ${generation}`;
  name.append(title, subtitle);
  identity.append(dot, name);

  const connection = document.createElement("dl");
  connection.className = "viewer-debug-grid";
  appendFact(connection, "Connection", slot?.connectionId || "waiting-ready");
  appendFact(connection, "PC state", stateLabel);
  appendFact(connection, "ICE", slot?.pc.iceConnectionState || "new");
  appendFact(connection, "Signaling", slot?.pc.signalingState || "stable");
  appendFact(connection, "Frames", String(slot?.stats.framesEncoded || 0));
  appendFact(connection, "Outbound", formatBytes(slot?.stats.bytesSent || 0));
  appendFact(connection, "Packets", String(slot?.stats.packetsSent || 0));
  appendFact(connection, "ICE route", slot?.stats.route || "pending");
  appendFact(
    connection,
    "RTT",
    `${Math.round((slot?.stats.roundTripTime || 0) * 1000)} ms`,
  );

  row.append(identity, connection);
  return row;
}

function appendFact(container, label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  wrapper.append(term, detail);
  container.append(wrapper);
}

function closeViewerSlots(peerId) {
  for (const [connectionId, slot] of state.viewers) {
    if (slot.peerId === peerId) {
      closeViewerSlot(connectionId);
    }
  }
}

function closeViewerSlot(connectionId) {
  const slot = state.viewers.get(connectionId);
  if (!slot) {
    return;
  }
  slot.pc.onicecandidate = null;
  slot.pc.onconnectionstatechange = null;
  slot.pc.oniceconnectionstatechange = null;
  slot.pc.onsignalingstatechange = null;
  slot.pc.close();
  state.viewers.delete(connectionId);
  renderViewers();
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
    const closed = await state.client.call(
      "close",
      memberFields(state.sessionId, state.owner),
    );
    state.latestCursor = Math.max(state.latestCursor, Number(closed["current-cursor"] || 0));
    elements.sessionCursor.textContent = String(state.latestCursor);
    telemetry.add({
      source: "owner",
      code: "CLOSE",
      message: "Broadcast closed by owner",
      meta: `cursor ${state.latestCursor}`,
    });
  } catch (error) {
    if (
      error instanceof DeviceRequestError &&
      error.status === 410 &&
      error.reason === "session-closed"
    ) {
      teardown("Ended");
      return;
    }
    telemetry.add({
      source: "owner",
      code: "ERR",
      message: "Broadcast close failed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
    suspendUnconfirmedClose();
    return;
  }
  teardown("Ended");
}

async function handleFatal(error) {
  if (state.fatalHandled || state.stopping) {
    return;
  }
  state.fatalHandled = true;
  telemetry.add({
    source: "broadcaster",
    code: "ERR",
    message: "Broadcast control flow stopped",
    meta: error instanceof Error ? error.message : "unknown-error",
    error: true,
  });
  elements.sessionStatus.textContent = "error";
  if (!state.client || !state.owner?.generation) {
    teardown("Failed");
    return;
  }
  state.stopping = true;
  try {
    await state.client.call(
      "close",
      memberFields(state.sessionId, state.owner),
      { silent: true },
    );
    teardown("Failed");
  } catch (closeError) {
    if (
      closeError instanceof DeviceRequestError &&
      closeError.status === 410 &&
      closeError.reason === "session-closed"
    ) {
      teardown("Failed");
      return;
    }
    telemetry.add({
      source: "owner",
      code: "UNCERTAIN",
      message: "Session close could not be confirmed",
      meta: closeError instanceof Error ? closeError.message : "unknown-error",
      error: true,
    });
    suspendUnconfirmedClose();
  }
}

function teardown(label) {
  state.runId += 1;
  state.running = false;
  state.stopping = false;
  state.closeUnconfirmed = false;
  clearIntervals();
  for (const connectionId of Array.from(state.viewers.keys())) {
    closeViewerSlot(connectionId);
  }
  state.canvasStream?.getTracks().forEach((track) => track.stop());
  state.canvasStream = null;
  state.watchUrl = "";
  elements.copyButton.disabled = true;
  elements.openButton.disabled = true;
  elements.watchUrl.value = "Broadcast ended";
  elements.liveLabel.classList.remove("live");
  elements.liveLabelText.textContent = label;
  elements.stopButton.textContent = "End broadcast";
  elements.sessionStatus.textContent = label.toLowerCase();
  elements.viewerReadout.textContent = "0 connected";
  setControlState(label);
  setRunControls(false);
}

function suspendUnconfirmedClose() {
  state.runId += 1;
  state.running = false;
  state.stopping = false;
  state.closeUnconfirmed = true;
  clearIntervals();
  for (const connectionId of Array.from(state.viewers.keys())) {
    closeViewerSlot(connectionId);
  }
  state.canvasStream?.getTracks().forEach((track) => track.stop());
  state.canvasStream = null;
  state.watchUrl = "";
  elements.copyButton.disabled = true;
  elements.openButton.disabled = true;
  elements.watchUrl.value = "Close unconfirmed";
  elements.liveLabel.classList.remove("live");
  elements.liveLabelText.textContent = "Close uncertain";
  elements.sessionStatus.textContent = "close unconfirmed";
  elements.viewerReadout.textContent = "0 connected";
  elements.startButton.disabled = true;
  elements.stopButton.disabled = false;
  elements.stopButton.textContent = "Retry close";
  elements.nodeUrl.disabled = true;
  elements.probeButton.disabled = true;
  setControlState("Awaiting close confirmation");
}

function handlePageHide() {
  if (state.running || state.stopping || state.closeUnconfirmed) {
    teardown("Suspended");
  }
}

function drawPublisherFrame(timestamp) {
  const canvas = elements.publisherCanvas;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const seconds = timestamp / 1000;

  context.fillStyle = "#07100c";
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(
    width * (0.55 + Math.sin(seconds * 0.21) * 0.12),
    height * 0.42,
    20,
    width * 0.5,
    height * 0.5,
    width * 0.75,
  );
  glow.addColorStop(0, "rgba(200, 255, 61, 0.2)");
  glow.addColorStop(0.48, "rgba(49, 150, 95, 0.08)");
  glow.addColorStop(1, "rgba(7, 16, 12, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(200, 255, 61, 0.09)";
  context.lineWidth = 1;
  const gridOffset = (seconds * 18) % 64;
  for (let x = -64 + gridOffset; x < width + 64; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = -64 + gridOffset; y < height + 64; y += 64) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.strokeStyle = "#c8ff3d";
  context.lineWidth = 4;
  context.shadowColor = "rgba(200, 255, 61, 0.5)";
  context.shadowBlur = 18;
  context.beginPath();
  for (let x = 0; x <= width; x += 8) {
    const phase = x / width;
    const y =
      height * 0.55 +
      Math.sin(phase * Math.PI * 5 + seconds * 2.2) * 52 +
      Math.sin(phase * Math.PI * 13 - seconds * 1.1) * 17;
    if (x === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.stroke();
  context.shadowBlur = 0;

  const orbitX = width * 0.78;
  const orbitY = height * 0.35;
  context.strokeStyle = "rgba(242, 246, 243, 0.22)";
  context.lineWidth = 2;
  for (let radius = 74; radius <= 170; radius += 32) {
    context.beginPath();
    context.arc(orbitX, orbitY, radius, seconds * 0.24, seconds * 0.24 + Math.PI * 1.55);
    context.stroke();
  }
  context.fillStyle = "#c8ff3d";
  context.beginPath();
  context.arc(
    orbitX + Math.cos(seconds * 1.4) * 122,
    orbitY + Math.sin(seconds * 1.4) * 122,
    9,
    0,
    Math.PI * 2,
  );
  context.fill();

  context.fillStyle = "rgba(242, 246, 243, 0.55)";
  context.font = '600 18px "SFMono-Regular", Consolas, monospace';
  context.fillText("HYPERBEAM LIVE SOURCE / 30 FPS", 52, 62);
  context.fillStyle = "#f2f6f3";
  context.font = '600 46px Inter, system-ui, sans-serif';
  context.fillText("HYPERSTREAM", 52, 146);
  context.fillStyle = "#c8ff3d";
  context.font = '500 22px "SFMono-Regular", Consolas, monospace';
  context.fillText("PUBLISHER → TARGETED WEBRTC PEERS", 56, 186);

  window.requestAnimationFrame(drawPublisherFrame);
}

elements.nodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void probeNode();
});
elements.startButton.addEventListener("click", () => void startBroadcast());
elements.stopButton.addEventListener("click", () => void stopBroadcast());
elements.copyButton.addEventListener("click", () => void copyWatchUrl());
elements.openButton.addEventListener("click", openWatchUrl);
elements.clearButton.addEventListener("click", () => telemetry.reset());
window.addEventListener("pagehide", handlePageHide);

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
        proofCount: state.proofs.size,
        connections: Array.from(state.viewers.values()).map((slot) => ({
          viewerPeerId: slot.peerId,
          viewerGeneration: slot.generation,
          connectionId: slot.connectionId,
          connectionState: slot.pc.connectionState,
          iceConnectionState: slot.pc.iceConnectionState,
          signalingState: slot.pc.signalingState,
          bytesSent: slot.stats.bytesSent,
          packetsSent: slot.stats.packetsSent,
          framesEncoded: slot.stats.framesEncoded,
          route: slot.stats.route,
          roundTripTime: slot.stats.roundTripTime,
        })),
      }),
  }),
  writable: false,
  configurable: false,
});

telemetry.reset();
elements.nodeUrl.value = defaultNodeEndpoint();
window.requestAnimationFrame(drawPublisherFrame);
void probeNode({ quiet: true });
