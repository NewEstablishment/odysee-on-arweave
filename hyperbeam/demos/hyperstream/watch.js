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
  selectedCandidateRoute,
  validIceCandidate,
  validSessionDescription,
  wait,
} from "./shared.js";

const elements = {
  headerSession: document.querySelector("#header-session"),
  nodeDot: document.querySelector("#node-dot"),
  nodeStatus: document.querySelector("#node-status"),
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
  bytesReceived: document.querySelector("#bytes-received"),
  packetsReceived: document.querySelector("#packets-received"),
  packetsLost: document.querySelector("#packets-lost"),
  jitter: document.querySelector("#jitter"),
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
  client: null,
  peer: null,
  publisherGeneration: 0,
  connectionId: null,
  pc: null,
  remoteStream: null,
  running: false,
  stopping: false,
  resyncing: false,
  memberActive: false,
  runId: 0,
  intervals: new Set(),
  sendChain: Promise.resolve(),
  outboundReady: false,
  outboundIce: [],
  inboundIce: [],
  latestCursor: 0,
  requestCount: 0,
  signalCount: 0,
  foreignSignalCount: 0,
  startedAt: 0,
  mediaStartedAt: 0,
  waitingForOfferAt: 0,
  fatalHandled: false,
  heartbeatFailures: 0,
  stats: {
    framesDecoded: 0,
    bytesReceived: 0,
    packetsReceived: 0,
    packetsLost: 0,
    jitter: 0,
    width: 0,
    height: 0,
    route: "pending",
    roundTripTime: 0,
  },
};

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
  closePeerConnection();
  state.peer = createPeer("viewer", "viewer");
  state.publisherGeneration = 0;
  state.connectionId = randomId("pc");
  state.pc = null;
  state.remoteStream = null;
  state.running = false;
  state.stopping = false;
  state.resyncing = false;
  state.memberActive = false;
  state.sendChain = Promise.resolve();
  state.outboundReady = false;
  state.outboundIce = [];
  state.inboundIce = [];
  state.latestCursor = 0;
  state.requestCount = 0;
  state.signalCount = 0;
  state.foreignSignalCount = 0;
  state.startedAt = performance.now();
  state.mediaStartedAt = 0;
  state.waitingForOfferAt = 0;
  state.fatalHandled = false;
  state.heartbeatFailures = 0;
  state.stats = {
    framesDecoded: 0,
    bytesReceived: 0,
    packetsReceived: 0,
    packetsLost: 0,
    jitter: 0,
    width: 0,
    height: 0,
  };
  telemetry.reset();

  elements.retryButton.hidden = true;
  elements.leaveButton.disabled = true;
  elements.viewerVideo.classList.remove("ready");
  elements.standby.classList.remove("hidden");
  elements.standbyTitle.textContent = "Joining Hyperstream session";
  elements.standbyDetail.textContent =
    "The viewer is registering its signed peer identity and waiting for an offer.";
  elements.liveLabel.classList.remove("live");
  elements.timecode.textContent = "00:00:00";
  elements.videoReadout.textContent = "No frames";
  elements.connectionReadout.textContent = "New";
  elements.iceReadout.textContent = "New";
  elements.viewerPeer.textContent = state.peer.id;
  elements.viewerGeneration.textContent = "0";
  elements.publisherPeer.textContent = state.invite.publisherId;
  elements.connectionId.textContent = state.connectionId;
  elements.sessionCursor.textContent = "0";
  elements.signalingState.textContent = "stable";
  elements.gatheringState.textContent = "new";
  elements.videoDimensions.textContent = "0 × 0";
  elements.framesDecoded.textContent = "0";
  elements.bytesReceived.textContent = "0 B";
  elements.packetsReceived.textContent = "0";
  elements.packetsLost.textContent = "0";
  elements.jitter.textContent = "0 ms";
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

    const joinRequest = {
      "request-id": randomId("join-viewer"),
      "session-id": state.invite.sessionId,
      "peer-id": state.peer.id,
      metadata: {
        role: "viewer",
        client: "hyperstream-watch",
        protocol: "hyperstream-webrtc-demo@1",
      },
    };

    const joined = await state.client.call("join", joinRequest);
    state.peer.generation = Number(joined["peer-generation"]);
    state.peer.cursor = Number(joined["current-cursor"] || 0);
    state.latestCursor = state.peer.cursor;
    state.memberActive = true;
    const snapshot = await state.client.call(
      "session",
      memberFields(state.invite.sessionId, state.peer),
      { silent: true },
    );
    if (!sessionDescriptorMatches(snapshot)) {
      throw new Error("The watch descriptor does not match owner-controlled session metadata.");
    }
    state.publisherGeneration = findPublisherGeneration(snapshot);
    if (!state.publisherGeneration) {
      throw new Error("The publisher peer is not active in this session.");
    }

    state.running = true;
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

    createPeerConnection();
    const runId = state.runId;
    void pollViewer(runId);
    addInterval(() => void heartbeatViewer(runId), 10_000);
    addInterval(() => void refreshSession(runId), 3_000);
    addInterval(() => void sampleInboundStats(runId), 1_000);
    addInterval(() => void ensureOffer(runId), 2_000);
    addInterval(() => updateTimecode(), 250);
    await sendViewerSignal("watch-ready", fencedBody());
    state.waitingForOfferAt = performance.now();
    setViewerStatus("Waiting for offer");
    elements.standbyTitle.textContent = "Viewer joined";
    elements.standbyDetail.textContent =
      "A targeted watch-ready signal is queued; the publisher will answer with an SDP offer.";
  } catch (error) {
    await handleFatal(error);
  }
}

function sessionDescriptorMatches(snapshot) {
  return (
    snapshot?.metadata?.protocol === "hyperstream-webrtc-demo@1" &&
    snapshot.metadata["publisher-peer-id"] === state.invite.publisherId
  );
}

function findPublisherGeneration(snapshot) {
  const peers = Array.isArray(snapshot?.peers) ? snapshot.peers : [];
  const publisher = peers.find(
    (peer) => peer["peer-id"] === state.invite.publisherId,
  );
  return Number(publisher?.["peer-generation"] || 0);
}

function createPeerConnection() {
  closePeerConnection();
  const pc = new RTCPeerConnection(peerConnectionConfiguration());
  state.pc = pc;
  state.remoteStream = new MediaStream();
  elements.viewerVideo.srcObject = state.remoteStream;

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      queueViewerIce(candidate);
    }
  };
  pc.ontrack = ({ track, streams }) => {
    const [stream] = streams;
    if (stream) {
      state.remoteStream = stream;
      elements.viewerVideo.srcObject = stream;
    } else if (!state.remoteStream.getTracks().some((item) => item.id === track.id)) {
      state.remoteStream.addTrack(track);
    }
    void elements.viewerVideo.play().catch(() => {});
    telemetry.add({
      source: "webrtc",
      code: "TRACK",
      message: `${track.kind} track received`,
      meta: `readyState ${track.readyState}`,
    });
  };
  pc.onconnectionstatechange = () => {
    renderPeerConnection();
    if (pc.connectionState === "failed") {
      void restartNegotiation().catch(handleFatal);
    }
  };
  pc.oniceconnectionstatechange = renderPeerConnection;
  pc.onicegatheringstatechange = renderPeerConnection;
  pc.onsignalingstatechange = renderPeerConnection;
  renderPeerConnection();
}

function closePeerConnection() {
  if (state.pc) {
    state.pc.onicecandidate = null;
    state.pc.ontrack = null;
    state.pc.onconnectionstatechange = null;
    state.pc.oniceconnectionstatechange = null;
    state.pc.onicegatheringstatechange = null;
    state.pc.onsignalingstatechange = null;
    state.pc.close();
    state.pc = null;
  }
  if (state.remoteStream) {
    state.remoteStream.getTracks().forEach((track) => track.stop());
    state.remoteStream = null;
  }
  elements.viewerVideo.srcObject = null;
}

function renderPeerConnection() {
  const connectionState = state.pc?.connectionState || "closed";
  const iceState = state.pc?.iceConnectionState || "closed";
  const signalingState = state.pc?.signalingState || "closed";
  const gatheringState = state.pc?.iceGatheringState || "complete";
  elements.connectionReadout.textContent = connectionState;
  elements.iceReadout.textContent = iceState;
  elements.signalingState.textContent = signalingState;
  elements.gatheringState.textContent = gatheringState;
  if (connectionState === "connected") {
    setViewerStatus("Connected");
  }
}

function fencedBody(values = {}) {
  return {
    protocol: "hyperstream-webrtc-demo@1",
    "publisher-peer-id": state.invite.publisherId,
    "publisher-generation": state.publisherGeneration,
    "viewer-peer-id": state.peer.id,
    "viewer-generation": state.peer.generation,
    ...values,
  };
}

function bodyMatchesViewer(body) {
  return (
    body?.protocol === "hyperstream-webrtc-demo@1" &&
    body["publisher-peer-id"] === state.invite.publisherId &&
    Number(body["publisher-generation"]) === state.publisherGeneration &&
    body["viewer-peer-id"] === state.peer.id &&
    Number(body["viewer-generation"]) === state.peer.generation
  );
}

function eventMatchesViewer(event) {
  return (
    event["to-peer-id"] === state.peer.id &&
    event["from-peer-id"] === state.invite.publisherId &&
    Number(event["from-peer-generation"]) === state.publisherGeneration &&
    event["connection-id"] === state.connectionId
  );
}

function viewerStateMatches(runId, peer, connectionId = null) {
  return (
    state.running &&
    !state.stopping &&
    state.runId === runId &&
    state.peer === peer &&
    (connectionId === null || state.connectionId === connectionId)
  );
}

function queueSignal(kind, body, requestId = randomId(kind)) {
  const previous = state.sendChain;
  const next = previous.then(() => sendViewerSignal(kind, body, requestId));
  state.sendChain = next.catch(() => {});
  return next;
}

async function sendViewerSignal(kind, body, requestId = randomId(kind)) {
  const runId = state.runId;
  const peer = state.peer;
  const connectionId = state.connectionId;
  const publisherGeneration = state.publisherGeneration;
  const accepted = await state.client.call(
    "signal",
    {
      ...memberFields(state.invite.sessionId, peer),
      "request-id": requestId,
      "to-peer-id": state.invite.publisherId,
      "connection-id": connectionId,
      kind,
      "content-type": "application/json",
      body,
    },
    { silent: true },
  );
  if (!viewerStateMatches(runId, peer, connectionId)) {
    return accepted;
  }
  state.latestCursor = Math.max(state.latestCursor, Number(accepted.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);
  if (!accepted.duplicate) {
    state.signalCount += 1;
    elements.signalCount.textContent = String(state.signalCount);
  }
  telemetry.add({
    source: "viewer",
    code: accepted.duplicate ? "DUP" : "202",
    message: `${kind} → ${state.invite.publisherId}`,
    meta: `g${publisherGeneration} · cursor ${accepted.cursor} · ${formatBytes(safeBodySize(body))}`,
  });
  return accepted;
}

function queueViewerIce(candidate) {
  const runId = state.runId;
  const peer = state.peer;
  const connectionId = state.connectionId;
  const value = candidate.toJSON
    ? candidate.toJSON()
    : {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      };
  if (!state.outboundReady) {
    state.outboundIce.push(value);
    return;
  }
  void queueSignal("ice", fencedBody({ ice: value })).catch((error) => {
    if (viewerStateMatches(runId, peer, connectionId)) {
      void handleFatal(error);
    }
  });
}

async function flushViewerIce() {
  state.outboundReady = true;
  const queued = state.outboundIce.splice(0);
  for (const ice of queued) {
    await queueSignal("ice", fencedBody({ ice }));
  }
}

async function pollViewer(runId) {
  let consecutiveErrors = 0;
  let firstErrorAt = 0;
  const peer = state.peer;
  while (state.running && !state.stopping && state.runId === runId) {
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
      if (!viewerStateMatches(runId, peer)) {
        return;
      }
      const events = Array.isArray(page.events) ? page.events : [];
      for (const event of events) {
        await handleViewerEvent(event);
        if (!viewerStateMatches(runId, peer)) {
          return;
        }
      }
      peer.cursor = Number(page["next-cursor"] || peer.cursor);
      state.latestCursor = Math.max(state.latestCursor, Number(page["current-cursor"] || 0));
      elements.sessionCursor.textContent = String(state.latestCursor);
      consecutiveErrors = 0;
      firstErrorAt = 0;
      await wait(responseHasMore(page["has-more"]) ? 40 : 300);
    } catch (error) {
      if (!state.running || state.stopping || state.runId !== runId) {
        return;
      }
      if (membershipLost(error)) {
        await rejoinLostPeer(runId, peer);
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
          if (membershipLost(recoveryError)) {
            await rejoinLostPeer(runId, peer);
          } else if (
            recoveryError instanceof DeviceRequestError &&
            recoveryError.status === 410 &&
            recoveryError.reason === "session-closed"
          ) {
            finishViewer("Ended", "The Hyperstream session has closed.", true, true);
          } else {
            await handleFatal(recoveryError);
          }
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

async function handleViewerEvent(event) {
  state.latestCursor = Math.max(state.latestCursor, Number(event.cursor || 0));
  elements.sessionCursor.textContent = String(state.latestCursor);

  if (event.type === "session-closed") {
    telemetry.add({
      source: "session",
      code: "CLOSE",
      message: "Broadcast session closed",
      meta: `${event.reason || "closed"} · cursor ${event.cursor}`,
    });
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
    source: "publisher",
    code: "SIGNAL",
    message: `${event.kind} from ${event["from-peer-id"]}`,
    meta: `g${event["from-peer-generation"]} · cursor ${event.cursor} · ${formatBytes(safeBodySize(event.body))}`,
  });

  if (event.kind === "resync-required") {
    if (!controlSignalMatchesViewer(event) || !bodyMatchesViewer(event.body)) {
      markForeignSignal(event);
      return;
    }
    telemetry.add({
      source: "viewer",
      code: "RESYNC",
      message: "Publisher requested a fresh negotiation",
      meta: event.body.reason || "resync-required",
    });
    await restartNegotiation();
    return;
  }

  if (!eventMatchesViewer(event) || !bodyMatchesViewer(event.body)) {
    markForeignSignal(event);
    return;
  }

  if (event.kind === "watch-rejected") {
    await releaseCurrentMembership();
    finishViewer(
      "Unavailable",
      `The broadcaster declined this media connection: ${event.body.reason || "not-admitted"}.`,
      true,
    );
  } else if (event.kind === "offer") {
    await acceptOffer(event.body);
  } else if (event.kind === "ice") {
    await acceptPublisherIce(event.body);
  }
}

function controlSignalMatchesViewer(event) {
  return (
    event["to-peer-id"] === state.peer.id &&
    event["from-peer-id"] === state.invite.publisherId &&
    Number(event["from-peer-generation"]) === state.publisherGeneration
  );
}

function markForeignSignal(event) {
  state.foreignSignalCount += 1;
  elements.foreignSignalCount.textContent = String(state.foreignSignalCount);
  telemetry.add({
    source: "viewer",
    code: "FENCE",
    message: `${event.kind} ignored`,
    meta: "peer, generation, connection, or body fence mismatch",
    error: true,
  });
}

async function acceptOffer(body) {
  if (!validSessionDescription(body.description, "offer")) {
    throw new Error("The publisher sent an invalid offer description.");
  }
  const runId = state.runId;
  const peer = state.peer;
  const connectionId = state.connectionId;
  const pc = state.pc;
  state.waitingForOfferAt = 0;
  await pc.setRemoteDescription(body.description);
  if (!viewerStateMatches(runId, peer, connectionId) || state.pc !== pc) {
    return;
  }
  for (const ice of state.inboundIce.splice(0)) {
    await pc.addIceCandidate(ice);
    if (!viewerStateMatches(runId, peer, connectionId) || state.pc !== pc) {
      return;
    }
  }
  const answer = await pc.createAnswer();
  if (!viewerStateMatches(runId, peer, connectionId) || state.pc !== pc) {
    return;
  }
  await pc.setLocalDescription(answer);
  if (!viewerStateMatches(runId, peer, connectionId) || state.pc !== pc) {
    return;
  }
  await queueSignal(
    "answer",
    fencedBody({
      description: {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
      },
    }),
  );
  if (!viewerStateMatches(runId, peer, connectionId) || state.pc !== pc) {
    return;
  }
  await flushViewerIce();
  setViewerStatus("Negotiating media");
}

async function acceptPublisherIce(body) {
  if (!validIceCandidate(body.ice)) {
    throw new Error("The publisher sent an invalid ICE signal.");
  }
  const runId = state.runId;
  const peer = state.peer;
  const connectionId = state.connectionId;
  const pc = state.pc;
  if (!pc.remoteDescription) {
    state.inboundIce.push(body.ice);
  } else {
    await pc.addIceCandidate(body.ice);
    if (!viewerStateMatches(runId, peer, connectionId) || state.pc !== pc) {
      return;
    }
  }
}

async function heartbeatViewer(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  const peer = state.peer;
  try {
    await state.client.call(
      "heartbeat",
      {
        ...memberFields(state.invite.sessionId, peer),
        "ack-cursor": peer.cursor,
      },
      { silent: true },
    );
    if (viewerStateMatches(runId, peer)) {
      state.heartbeatFailures = 0;
    }
  } catch (error) {
    if (viewerStateMatches(runId, peer)) {
      if (membershipLost(error)) {
        await rejoinLostPeer(runId, peer);
      } else {
        state.heartbeatFailures += 1;
        if (!retryableRequestError(error) || state.heartbeatFailures >= 3) {
          await handleFatal(error);
        }
      }
    }
  }
}

async function refreshSession(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  const peer = state.peer;
  try {
    const snapshot = await state.client.call(
      "session",
      memberFields(state.invite.sessionId, peer),
      { silent: true },
    );
    if (!viewerStateMatches(runId, peer)) {
      return;
    }
    if (!sessionDescriptorMatches(snapshot)) {
      throw new Error("Owner-controlled session metadata no longer matches this watch URL.");
    }
    state.latestCursor = Math.max(state.latestCursor, Number(snapshot["current-cursor"] || 0));
    elements.sessionCursor.textContent = String(state.latestCursor);
    if (snapshot["session-status"] === "closed") {
      finishViewer("Ended", "The Hyperstream session has closed.", true, true);
    }
  } catch (error) {
    if (!viewerStateMatches(runId, peer)) {
      return;
    }
    if (membershipLost(error)) {
      await rejoinLostPeer(runId, peer);
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
    if (!retryableRequestError(error)) {
      await handleFatal(error);
    }
  }
}

async function rejoinLostPeer(runId, peer) {
  if (!viewerStateMatches(runId, peer)) {
    return;
  }
  telemetry.add({
    source: "viewer",
    code: "REJOIN",
    message: "Peer membership was lost; creating a fresh membership",
    meta: peer.id,
  });
  finishViewer(
    "Rejoining",
    "The peer membership was lost; creating a new viewer membership.",
    false,
    true,
  );
  await joinStream();
}

async function recoverViewerCursor(runId) {
  if (!state.running || state.stopping || state.runId !== runId) {
    return;
  }
  const peer = state.peer;
  const snapshot = await state.client.call(
    "session",
    memberFields(state.invite.sessionId, peer),
    { silent: true },
  );
  if (!viewerStateMatches(runId, peer)) {
    return;
  }
  if (snapshot["session-status"] === "closed") {
    finishViewer("Ended", "The Hyperstream session has closed.", true, true);
    return;
  }
  if (!sessionDescriptorMatches(snapshot)) {
    throw new Error("Owner-controlled session metadata no longer matches this watch URL.");
  }
  const publisherGeneration = findPublisherGeneration(snapshot);
  if (!publisherGeneration) {
    throw new Error("The publisher peer is no longer active.");
  }
  state.publisherGeneration = publisherGeneration;
  state.peer.cursor = Number(snapshot["current-cursor"] || 0);
  state.latestCursor = Math.max(state.latestCursor, state.peer.cursor);
  elements.sessionCursor.textContent = String(state.latestCursor);
  telemetry.add({
    source: "viewer",
    code: "RESYNC",
    message: "Expired event cursor refreshed from session state",
    meta: `cursor ${state.peer.cursor}`,
  });
  await restartNegotiation();
}

async function restartNegotiation() {
  if (!state.running || state.stopping || state.resyncing) {
    return;
  }
  state.resyncing = true;
  const runId = state.runId;
  const peer = state.peer;
  try {
    closePeerConnection();
    state.connectionId = randomId("pc");
    state.sendChain = Promise.resolve();
    state.outboundReady = false;
    state.outboundIce = [];
    state.inboundIce = [];
    state.mediaStartedAt = 0;
    state.stats = {
      framesDecoded: 0,
      bytesReceived: 0,
      packetsReceived: 0,
      packetsLost: 0,
      jitter: 0,
      width: 0,
      height: 0,
      route: "pending",
      roundTripTime: 0,
    };
    elements.connectionId.textContent = state.connectionId;
    elements.viewerVideo.classList.remove("ready");
    elements.standby.classList.remove("hidden");
    elements.standbyTitle.textContent = "Re-synchronizing";
    elements.standbyDetail.textContent =
      "The viewer refreshed session state and requested a new fenced offer.";
    elements.liveLabel.classList.remove("live");
    elements.videoReadout.textContent = "No frames";
    renderStats();
    createPeerConnection();
    const connectionId = state.connectionId;
    await sendViewerSignal("watch-ready", fencedBody());
    if (viewerStateMatches(runId, peer, connectionId)) {
      state.waitingForOfferAt = performance.now();
      setViewerStatus("Waiting for offer");
    }
  } finally {
    if (state.runId === runId && state.peer === peer) {
      state.resyncing = false;
    }
  }
}

async function ensureOffer(runId) {
  if (
    !state.waitingForOfferAt ||
    !state.pc ||
    state.pc.remoteDescription ||
    state.resyncing ||
    !viewerStateMatches(runId, state.peer)
  ) {
    return;
  }
  if (performance.now() - state.waitingForOfferAt < 5_000) {
    return;
  }
  telemetry.add({
    source: "viewer",
    code: "RETRY",
    message: "No offer arrived; requesting a fresh negotiation",
    meta: state.connectionId,
  });
  await restartNegotiation();
}

async function sampleInboundStats(runId) {
  if (!state.running || state.stopping || state.runId !== runId || !state.pc) {
    return;
  }
  const peer = state.peer;
  const connectionId = state.connectionId;
  const pc = state.pc;
  try {
    const reports = await pc.getStats();
    if (
      !viewerStateMatches(runId, peer, connectionId) ||
      state.pc !== pc
    ) {
      return;
    }
    reports.forEach((report) => {
      const video =
        report.type === "inbound-rtp" &&
        !report.isRemote &&
        (report.kind === "video" || report.mediaType === "video");
      if (video) {
        state.stats.framesDecoded = Number(report.framesDecoded || 0);
        state.stats.bytesReceived = Number(report.bytesReceived || 0);
        state.stats.packetsReceived = Number(report.packetsReceived || 0);
        state.stats.packetsLost = Number(report.packetsLost || 0);
        state.stats.jitter = Number(report.jitter || 0);
        state.stats.width = Number(report.frameWidth || elements.viewerVideo.videoWidth || 0);
        state.stats.height = Number(report.frameHeight || elements.viewerVideo.videoHeight || 0);
      }
    });
    const route = selectedCandidateRoute(reports);
    if (route) {
      const changed = route.label !== state.stats.route;
      state.stats.route = route.label;
      state.stats.roundTripTime = route.roundTripTime;
      if (changed) {
        telemetry.add({
          source: "webrtc",
          code: "ROUTE",
          message: "Selected ICE route established",
          meta: route.label,
        });
      }
    }
    renderStats();
  } catch {
    elements.videoReadout.textContent = "Stats unavailable";
  }
}

function renderStats() {
  elements.framesDecoded.textContent = String(state.stats.framesDecoded);
  elements.bytesReceived.textContent = formatBytes(state.stats.bytesReceived);
  elements.packetsReceived.textContent = String(state.stats.packetsReceived);
  elements.packetsLost.textContent = String(state.stats.packetsLost);
  elements.jitter.textContent = `${Math.round(state.stats.jitter * 1000)} ms`;
  elements.videoDimensions.textContent = `${state.stats.width} × ${state.stats.height}`;
  elements.iceRoute.textContent = state.stats.route;
  elements.roundTripTime.textContent =
    `${Math.round(state.stats.roundTripTime * 1000)} ms`;

  if (state.stats.framesDecoded > 0 && state.stats.bytesReceived > 0) {
    if (!state.mediaStartedAt) {
      state.mediaStartedAt = performance.now();
      telemetry.add({
        source: "webrtc",
        code: "RTP",
        message: "Inbound video is advancing",
        meta: `${state.stats.width} × ${state.stats.height} · ${formatBytes(state.stats.bytesReceived)}`,
      });
    }
    elements.videoReadout.textContent = `${state.stats.framesDecoded} frames`;
    elements.viewerVideo.classList.add("ready");
    elements.standby.classList.add("hidden");
    elements.liveLabel.classList.add("live");
    setViewerStatus("Live");
  }
}

function updateTimecode() {
  const origin = state.mediaStartedAt || state.startedAt;
  elements.timecode.textContent = formatElapsed(performance.now() - origin);
}

async function leaveStream() {
  if (!state.running || state.stopping) {
    return;
  }
  state.stopping = true;
  elements.leaveButton.disabled = true;
  setViewerStatus("Leaving");
  let leftConfirmed = false;
  try {
    const left = await state.client.call(
      "leave",
      memberFields(state.invite.sessionId, state.peer),
    );
    state.latestCursor = Math.max(state.latestCursor, Number(left["current-cursor"] || 0));
    state.memberActive = false;
    leftConfirmed = true;
    elements.sessionCursor.textContent = String(state.latestCursor);
    telemetry.add({
      source: "viewer",
      code: "LEAVE",
      message: "Viewer membership released",
      meta: `cursor ${state.latestCursor}`,
    });
  } catch (error) {
    telemetry.add({
      source: "viewer",
      code: "ERR",
      message: "Viewer leave failed",
      meta: error instanceof Error ? error.message : "unknown-error",
      error: true,
    });
    if (membershipLost(error)) {
      state.memberActive = false;
      leftConfirmed = true;
    }
  } finally {
    finishViewer("Left", "This viewer left the broadcast.", true, leftConfirmed);
  }
}

async function retryJoin() {
  await releaseCurrentMembership();
  await joinStream();
}

async function releaseCurrentMembership() {
  if (!state.client || !state.memberActive || !state.peer?.generation) {
    return;
  }
  try {
    await state.client.call(
      "leave",
      memberFields(state.invite.sessionId, state.peer),
      { silent: true },
    );
    state.memberActive = false;
  } catch (error) {
    if (membershipLost(error)) {
      state.memberActive = false;
    }
  }
}

async function handleFatal(error) {
  const runId = state.runId;
  const peer = state.peer;
  if (membershipLost(error) && viewerStateMatches(runId, peer)) {
    await rejoinLostPeer(runId, peer);
    return;
  }
  if (state.fatalHandled || state.stopping) {
    return;
  }
  state.fatalHandled = true;
  telemetry.add({
    source: "viewer",
    code: "ERR",
    message: "Viewer control flow stopped",
    meta: error instanceof Error ? error.message : "unknown-error",
    error: true,
  });
  await releaseCurrentMembership();
  setNodeState("error", "Connection failed");
  finishViewer(
    "Failed",
    error instanceof Error ? error.message : "The viewer could not join this broadcast.",
    true,
  );
}

function finishViewer(label, detail, retryable, membershipEnded = false) {
  state.runId += 1;
  state.running = false;
  state.stopping = false;
  clearIntervals();
  closePeerConnection();
  if (membershipEnded) {
    state.memberActive = false;
  }
  elements.liveLabel.classList.remove("live");
  elements.viewerVideo.classList.remove("ready");
  elements.standby.classList.remove("hidden");
  elements.standbyTitle.textContent = label;
  elements.standbyDetail.textContent = detail;
  elements.leaveButton.disabled = true;
  elements.retryButton.hidden = !retryable;
  elements.connectionReadout.textContent = "closed";
  elements.iceReadout.textContent = "closed";
  elements.signalingState.textContent = "closed";
  elements.gatheringState.textContent = "complete";
  setViewerStatus(label);
}

function handlePageHide() {
  if (state.running || state.memberActive) {
    state.memberActive = false;
    finishViewer(
      "Suspended",
      "This page left the active document. Retry to create a fresh viewer membership.",
      true,
      true,
    );
  }
}

function initializeInvite() {
  try {
    state.invite = decodeInvite(window.location.hash);
    elements.headerSession.textContent = state.invite.sessionId;
    elements.viewerNode.textContent = state.invite.endpoint;
    elements.sessionId.textContent = state.invite.sessionId;
    elements.publisherPeer.textContent = state.invite.publisherId;
    return true;
  } catch (error) {
    setNodeState("error", "Invalid watch URL");
    elements.headerSession.textContent = "Invalid invite";
    elements.retryButton.hidden = true;
    elements.leaveButton.disabled = true;
    elements.standbyTitle.textContent = "Cannot open broadcast";
    elements.standbyDetail.textContent =
      error instanceof Error ? error.message : "The watch URL is invalid.";
    setViewerStatus("Invalid invite");
    telemetry.add({
      source: "viewer",
      code: "ERR",
      message: "Watch URL rejected",
      meta: error instanceof Error ? error.message : "invalid-invite",
      error: true,
    });
    return false;
  }
}

elements.retryButton.addEventListener("click", () => void retryJoin());
elements.leaveButton.addEventListener("click", () => void leaveStream());
elements.clearButton.addEventListener("click", () => telemetry.reset());
window.addEventListener("pagehide", handlePageHide);

Object.defineProperty(window, "__hyperstreamViewer", {
  value: Object.freeze({
    diagnostics: () =>
      Object.freeze({
        active: state.running && !state.stopping,
        sessionId: state.invite?.sessionId || null,
        publisherPeerId: state.invite?.publisherId || null,
        publisherGeneration: state.publisherGeneration,
        viewerPeerId: state.peer?.id || null,
        viewerGeneration: state.peer?.generation || 0,
        connectionId: state.connectionId,
        cursor: state.latestCursor,
        requestCount: state.requestCount,
        signalCount: state.signalCount,
        foreignSignalCount: state.foreignSignalCount,
        connectionState: state.pc?.connectionState || "closed",
        iceConnectionState: state.pc?.iceConnectionState || "closed",
        signalingState: state.pc?.signalingState || "closed",
        framesDecoded: state.stats.framesDecoded,
        bytesReceived: state.stats.bytesReceived,
        packetsReceived: state.stats.packetsReceived,
        packetsLost: state.stats.packetsLost,
        jitter: state.stats.jitter,
        videoWidth: state.stats.width,
        videoHeight: state.stats.height,
        route: state.stats.route,
        roundTripTime: state.stats.roundTripTime,
      }),
  }),
  writable: false,
  configurable: false,
});

telemetry.reset();
if (initializeInvite()) {
  void joinStream();
}
