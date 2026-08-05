const ICE_GATHERING_TIMEOUT_MS = 10_000;
const WHIP_REQUEST_TIMEOUT_MS = 15_000;

export class WhipPublisher {
  constructor({ url, token, stream, onState = () => {} }) {
    this.url = new URL(url).href;
    this.token = token;
    this.stream = stream;
    this.onState = onState;
    this.pc = null;
    this.resourceUrl = null;
    this.startedAt = 0;
  }

  async start() {
    const iceServers = await this.discoverIceServers();
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    this.startedAt = performance.now();
    for (const track of this.stream.getTracks()) {
      const transceiver = pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this.stream],
      });
      if (track.kind === "video") {
        preferH264(transceiver);
      }
    }
    const notify = () => this.onState(this.state());
    pc.addEventListener("connectionstatechange", notify);
    pc.addEventListener("iceconnectionstatechange", notify);
    pc.addEventListener("icegatheringstatechange", notify);
    pc.addEventListener("signalingstatechange", notify);
    pc.addEventListener("negotiationneeded", notify);
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Accept: "application/sdp",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/sdp",
      },
      body: pc.localDescription.sdp,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(WHIP_REQUEST_TIMEOUT_MS),
    });
    const answer = await response.text();
    if (response.status !== 201 || !answer.startsWith("v=0")) {
      throw new Error(`WHIP ingest returned HTTP ${response.status}.`);
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("WHIP ingest did not return a resource location.");
    }
    this.resourceUrl = new URL(location, this.url).href;
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    notify();
    return this.state();
  }

  async discoverIceServers() {
    try {
      const response = await fetch(this.url, {
        method: "OPTIONS",
        headers: { Authorization: `Bearer ${this.token}` },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return [];
      }
      return parseIceServers(response.headers.get("link"));
    } catch {
      return [];
    }
  }

  state() {
    return {
      connectionState: this.pc?.connectionState || "new",
      iceConnectionState: this.pc?.iceConnectionState || "new",
      iceGatheringState: this.pc?.iceGatheringState || "new",
      signalingState: this.pc?.signalingState || "stable",
      resourceCreated: Boolean(this.resourceUrl),
    };
  }

  async stats() {
    if (!this.pc) {
      return emptyStats();
    }
    const reports = await this.pc.getStats();
    const result = emptyStats();
    for (const report of reports.values()) {
      if (report.type === "outbound-rtp" && report.kind === "video" && !report.isRemote) {
        result.bytesSent += Number(report.bytesSent || 0);
        result.packetsSent += Number(report.packetsSent || 0);
        result.framesSent += Number(report.framesSent || 0);
        result.framesPerSecond = Math.max(
          result.framesPerSecond,
          Number(report.framesPerSecond || 0),
        );
        result.width = Math.max(result.width, Number(report.frameWidth || 0));
        result.height = Math.max(result.height, Number(report.frameHeight || 0));
      }
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        const local = reports.get(report.localCandidateId);
        const remote = reports.get(report.remoteCandidateId);
        result.route = [local?.candidateType, remote?.candidateType, local?.protocol]
          .filter(Boolean)
          .join(" → ");
        result.roundTripTime = Number(report.currentRoundTripTime || 0);
      }
    }
    return result;
  }

  async stop() {
    const resourceUrl = this.resourceUrl;
    this.resourceUrl = null;
    if (resourceUrl) {
      try {
        await fetch(resourceUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.token}` },
          cache: "no-store",
          credentials: "omit",
          keepalive: true,
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
      }
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    for (const track of this.stream?.getTracks() || []) {
      track.stop();
    }
    this.onState(this.state());
  }
}

function preferH264(transceiver) {
  if (typeof transceiver.setCodecPreferences !== "function") {
    return;
  }
  const codecs = RTCRtpSender.getCapabilities?.("video")?.codecs || [];
  const h264 = codecs
    .filter((codec) => codec.mimeType.toLowerCase() === "video/h264")
    .sort((left, right) => {
      const leftPacketized = left.sdpFmtpLine?.includes("packetization-mode=1") ? 1 : 0;
      const rightPacketized = right.sdpFmtpLine?.includes("packetization-mode=1") ? 1 : 0;
      return rightPacketized - leftPacketized;
    });
  if (h264.length) {
    const repairCodecs = codecs.filter((codec) =>
      ["video/rtx", "video/red", "video/ulpfec"].includes(codec.mimeType.toLowerCase()),
    );
    transceiver.setCodecPreferences([...h264, ...repairCodecs]);
  }
}

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let timeout;
    const finish = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        finish();
      }
    };
    timeout = window.setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function parseIceServers(value) {
  if (!value) {
    return [];
  }
  const servers = [];
  const pattern = /<([^>]+)>\s*;\s*rel="ice-server"(?:\s*;\s*username="([^"]*)")?(?:\s*;\s*credential="([^"]*)")?/gi;
  for (const match of value.matchAll(pattern)) {
    const server = { urls: match[1] };
    if (match[2]) {
      server.username = match[2];
    }
    if (match[3]) {
      server.credential = match[3];
    }
    servers.push(server);
  }
  return servers;
}

function emptyStats() {
  return {
    bytesSent: 0,
    packetsSent: 0,
    framesSent: 0,
    framesPerSecond: 0,
    width: 0,
    height: 0,
    route: "pending",
    roundTripTime: 0,
  };
}
