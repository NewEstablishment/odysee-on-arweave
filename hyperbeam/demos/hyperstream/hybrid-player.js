import Hls from "hls.js";
import { HlsJsP2PEngine } from "p2p-media-loader-hlsjs";

const HLS_MIME_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegURL",
];
const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.cloudflare.com:3478" }];
const DEFAULT_STATS_INTERVAL_MS = 1_000;
const MAX_RECOVERY_ATTEMPTS = 4;
const RECOVERY_BASE_DELAY_MS = 500;
const RECOVERY_MAX_DELAY_MS = 4_000;
const RECOVERY_RESET_AFTER_MS = 30_000;

function noop() {}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function errorDetails(error) {
  if (error instanceof Error) {
    return {
      name: String(error.name || error.type || "Error"),
      message: String(error.message || error.type || error.name || "Unknown error"),
    };
  }
  if (error && typeof error === "object") {
    return {
      name: String(error.name || error.type || "Error"),
      message: String(error.message || error.reason || error.type || "Unknown error"),
    };
  }
  return {
    name: "Error",
    message: String(error || "Unknown error"),
  };
}

function loopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function normalizeManifestUrl(value) {
  const url = new URL(String(value || ""), globalThis.location?.href);
  if (url.username || url.password || url.hash) {
    throw new Error("The HLS manifest URL must not contain credentials or a fragment.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHostname(url.hostname))) {
    throw new Error("The HLS manifest must use HTTPS outside loopback development.");
  }
  return url.href;
}

function normalizeTrackerUrls(values) {
  if (values == null) {
    return [];
  }
  if (!Array.isArray(values) || values.length > 4) {
    throw new Error("trackerUrls must be an array containing at most four private trackers.");
  }
  return [...new Set(values.map((value) => {
    const url = new URL(String(value || ""), globalThis.location?.href);
    if (url.username || url.password || url.hash) {
      throw new Error("Tracker URLs must not contain credentials or fragments.");
    }
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopbackHostname(url.hostname))) {
      throw new Error("Trackers must use WSS outside loopback development.");
    }
    return url.href;
  }))];
}

function normalizeSwarmId(value) {
  const swarmId = String(value || "").trim();
  if (swarmId.length < 8 || swarmId.length > 256 || /[\u0000-\u001f\u007f]/.test(swarmId)) {
    throw new Error("swarmId must be a stable 8 to 256 character identifier.");
  }
  return swarmId;
}

function stableMasterPlaylist(value) {
  return String(value).replace(
    /^#EXT-X-STREAM-INF:.*$/gm,
    "#EXT-X-STREAM-INF:BANDWIDTH=1",
  );
}

function stablePlaylistLoader(manifestUrl) {
  const BaseLoader = Hls.DefaultConfig.loader;
  const manifest = new URL(manifestUrl);
  return class extends BaseLoader {
    load(context, config, callbacks) {
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, loaderContext, networkDetails) => {
          let value = response;
          try {
            const requestUrl = new URL(context.url, manifest);
            if (
              requestUrl.origin === manifest.origin &&
              requestUrl.pathname === manifest.pathname &&
              typeof response.data === "string" &&
              response.data.includes("#EXT-X-STREAM-INF:")
            ) {
              value = { ...response, data: stableMasterPlaylist(response.data) };
            }
          } catch {}
          callbacks.onSuccess(value, stats, loaderContext, networkDetails);
        },
      });
    }
  };
}

function normalizeIceServers(value) {
  const iceServers = value == null ? DEFAULT_ICE_SERVERS : value;
  if (!Array.isArray(iceServers) || iceServers.length > 8) {
    throw new Error("iceServers must be an array containing at most eight entries.");
  }
  return structuredClone(iceServers);
}

function bufferedSeconds(video) {
  const currentTime = finiteNumber(video.currentTime);
  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (currentTime >= start - 0.05 && currentTime <= end + 0.05) {
      return Math.max(0, end - currentTime);
    }
  }
  return 0;
}

function playbackQuality(video) {
  if (typeof video.getVideoPlaybackQuality !== "function") {
    return {
      decodedFrames: 0,
      droppedFrames: 0,
    };
  }
  const quality = video.getVideoPlaybackQuality();
  return {
    decodedFrames: finiteNumber(quality.totalVideoFrames),
    droppedFrames: finiteNumber(quality.droppedVideoFrames),
  };
}

function nativeHlsSupported(video) {
  return HLS_MIME_TYPES.some((mimeType) => Boolean(video.canPlayType(mimeType)));
}

function safeCallback(callback, value) {
  try {
    callback(value);
  } catch {}
}

export class HybridPlayer {
  constructor(video, options) {
    if (!(video instanceof HTMLVideoElement)) {
      throw new TypeError("HybridPlayer requires an HTMLVideoElement.");
    }
    const trackerUrls = normalizeTrackerUrls(options?.trackerUrls);
    const configuredP2P = options?.p2pEnabled !== false;
    this.video = video;
    this.manifestUrl = normalizeManifestUrl(options?.manifestUrl);
    this.trackerUrls = trackerUrls;
    this.swarmId = configuredP2P && trackerUrls.length > 0
      ? normalizeSwarmId(options?.swarmId)
      : String(options?.swarmId || "");
    this.iceServers = normalizeIceServers(options?.iceServers);
    this.onEvent = typeof options?.onEvent === "function" ? options.onEvent : noop;
    this.onStats = typeof options?.onStats === "function" ? options.onStats : noop;
    this.validateP2PSegment = typeof options?.validateP2PSegment === "function"
      ? options.validateP2PSegment
      : null;
    this.validateHTTPSegment = typeof options?.validateHTTPSegment === "function"
      ? options.validateHTTPSegment
      : null;
    this.autoplay = options?.autoplay !== false;
    this.p2pEnabled = configuredP2P && trackerUrls.length > 0;
    this.p2pUploadEnabled = options?.p2pUploadEnabled !== false;
    this.p2pMaxPeers = Math.min(32, Math.max(1, Math.trunc(finiteNumber(options?.p2pMaxPeers, 8))));
    this.statsIntervalMs = Math.max(500, finiteNumber(options?.statsIntervalMs, DEFAULT_STATS_INTERVAL_MS));
    this.hls = null;
    this.mode = "idle";
    this.destroyed = false;
    this.httpFallbackAttempted = false;
    this.recoveryAttempts = 0;
    this.recoveryTimer = null;
    this.recoveryResetTimer = null;
    this.terminalFailure = false;
    this.peers = new Set();
    this.statsTimer = null;
    this.mediaListeners = [];
    this.stats = {
      httpBytes: 0,
      p2pBytes: 0,
      p2pUploadBytes: 0,
      peerCount: 0,
      bufferSeconds: 0,
      liveLatencySeconds: null,
      segments: {
        total: 0,
        http: 0,
        p2p: 0,
        errors: 0,
      },
    };
  }

  async start() {
    this.assertActive();
    this.bindMediaEvents();
    this.startStats();
    if (Hls.isSupported()) {
      if (this.p2pEnabled && typeof globalThis.RTCPeerConnection === "function") {
        try {
          this.startHls(true, "configured");
          return this;
        } catch (error) {
          this.emit({
            type: "p2p-fallback",
            reason: "initialization-failed",
            error: errorDetails(error),
          });
        }
      } else if (this.p2pEnabled) {
        this.emit({
          type: "p2p-fallback",
          reason: "webrtc-unavailable",
        });
      } else {
        this.emit({
          type: "p2p-disabled",
          reason: this.trackerUrls.length === 0 ? "private-tracker-not-configured" : "disabled",
        });
      }
      this.startHls(false, "http-fallback");
      return this;
    }
    if (nativeHlsSupported(this.video)) {
      this.startNativeHls();
      return this;
    }
    throw new Error("This browser supports neither Hls.js playback nor native HLS.");
  }

  async play() {
    this.assertActive();
    try {
      await this.video.play();
      this.emit({ type: "playback", state: "playing" });
      return true;
    } catch (error) {
      this.emit({
        type: "playback-error",
        fatal: false,
        error: errorDetails(error),
      });
      return false;
    }
  }

  getStats() {
    this.updatePlaybackStats();
    const downloadedBytes = this.stats.httpBytes + this.stats.p2pBytes;
    const quality = playbackQuality(this.video);
    return {
      mode: this.mode,
      httpBytes: this.stats.httpBytes,
      p2pBytes: this.stats.p2pBytes,
      p2pUploadBytes: this.stats.p2pUploadBytes,
      p2pRatio: downloadedBytes > 0 ? this.stats.p2pBytes / downloadedBytes : 0,
      peerCount: this.peers.size,
      bufferSeconds: this.stats.bufferSeconds,
      liveLatencySeconds: this.stats.liveLatencySeconds,
      segments: { ...this.stats.segments },
      currentTime: finiteNumber(this.video.currentTime),
      paused: this.video.paused,
      readyState: this.video.readyState,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      decodedFrames: quality.decodedFrames,
      droppedFrames: quality.droppedFrames,
    };
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.statsTimer != null) {
      globalThis.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.clearRecoveryTimers();
    this.destroyHls();
    for (const [type, listener] of this.mediaListeners) {
      this.video.removeEventListener(type, listener);
    }
    this.mediaListeners = [];
    this.peers.clear();
    this.video.removeAttribute("src");
    this.video.load();
    this.mode = "destroyed";
    this.emit({ type: "destroyed" });
  }

  assertActive() {
    if (this.destroyed) {
      throw new Error("The hybrid player has been destroyed.");
    }
  }

  startHls(useP2P, reason) {
    this.destroyHls();
    const HlsConstructor = useP2P ? HlsJsP2PEngine.injectMixin(Hls) : Hls;
    const config = {
      backBufferLength: 30,
      capLevelOnFPSDrop: true,
      capLevelToPlayerSize: true,
      liveMaxLatencyDuration: 18,
      liveSyncDuration: 8,
      lowLatencyMode: false,
      maxBufferLength: 24,
      maxMaxBufferLength: 36,
      pLoader: stablePlaylistLoader(this.manifestUrl),
    };
    if (useP2P) {
      config.p2p = {
        core: {
          announceTrackers: this.trackerUrls,
          highDemandTimeWindow: 2,
          httpDownloadInitialTimeoutMs: 0,
          httpNotReceivingBytesTimeoutMs: 3_000,
          isP2PUploadDisabled: !this.p2pUploadEnabled,
          p2pMaxPeers: this.p2pMaxPeers,
          p2pNotReceivingBytesTimeoutMs: 8_000,
          rtcConfig: {
            iceServers: this.iceServers,
          },
          simultaneousHttpDownloads: 2,
          simultaneousP2PDownloads: 5,
          swarmId: this.swarmId,
          validateHTTPSegment: this.validateHTTPSegment
            ? (url, byteRange, data) => this.validateHTTPSegment({ url, byteRange, data, source: "http" })
            : undefined,
          validateP2PSegment: this.validateP2PSegment
            ? (url, byteRange, data) => this.validateP2PSegment({ url, byteRange, data, source: "p2p" })
            : undefined,
        },
      };
    }
    const hls = new HlsConstructor(config);
    this.hls = hls;
    this.mode = useP2P ? "hybrid-hls" : "http-hls";
    this.peers.clear();
    this.bindHlsEvents(hls, useP2P);
    hls.attachMedia(this.video);
    hls.loadSource(this.manifestUrl);
    this.emit({
      type: "mode",
      mode: this.mode,
      reason,
      manifestUrl: this.manifestUrl,
      swarmId: useP2P ? this.swarmId : null,
      trackerCount: useP2P ? this.trackerUrls.length : 0,
    });
  }

  startNativeHls() {
    this.destroyHls();
    this.mode = "native-hls";
    this.video.removeAttribute("src");
    this.video.load();
    this.video.src = this.manifestUrl;
    this.video.load();
    this.emit({
      type: "mode",
      mode: this.mode,
      reason: "hlsjs-unavailable",
      manifestUrl: this.manifestUrl,
    });
    if (this.autoplay) {
      void this.play();
    }
  }

  bindHlsEvents(hls, useP2P) {
    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      if (this.hls !== hls || this.destroyed) {
        return;
      }
      this.emit({
        type: "manifest",
        mode: this.mode,
        levels: Array.isArray(data?.levels) ? data.levels.length : 0,
      });
      if (this.autoplay) {
        void this.play();
      }
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      if (this.hls !== hls || this.destroyed) {
        return;
      }
      this.emit({
        type: "playlist",
        live: Boolean(data?.details?.live),
        segmentCount: Array.isArray(data?.details?.fragments) ? data.details.fragments.length : 0,
        targetDuration: finiteNumber(data?.details?.targetduration),
      });
    });
    hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
      if (this.hls !== hls || this.destroyed || useP2P) {
        return;
      }
      const bytes = finiteNumber(data?.stats?.loaded || data?.payload?.byteLength);
      this.stats.httpBytes += bytes;
      this.stats.segments.total += 1;
      this.stats.segments.http += 1;
      this.emit({
        type: "segment",
        source: "http",
        bytes,
        peerId: null,
        url: data?.frag?.url || null,
        externalId: data?.frag?.sn ?? null,
        streamType: data?.frag?.type || "main",
      });
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (this.hls !== hls || this.destroyed) {
        return;
      }
      this.emit({
        type: "hls-error",
        fatal: Boolean(data?.fatal),
        category: data?.type || "unknown",
        details: data?.details || "unknown",
        error: errorDetails(data?.error || data?.reason || data?.details),
      });
      if (!data?.fatal) {
        return;
      }
      if (useP2P && !this.httpFallbackAttempted) {
        this.httpFallbackAttempted = true;
        this.clearRecoveryResetTimer();
        this.emit({
          type: "p2p-fallback",
          reason: "fatal-hls-error",
          details: data?.details || "unknown",
        });
        this.scheduleHttpFallback(hls);
        return;
      }
      this.scheduleRecovery({
        source: "hlsjs",
        details: data?.details || "unknown",
        error: data?.error || data?.reason || data?.details,
        restart: (attempt) => this.startHls(false, `http-recovery-${attempt}`),
      });
    });
    if (useP2P && hls.p2pEngine) {
      this.bindP2PEvents(hls.p2pEngine);
    }
  }

  bindP2PEvents(engine) {
    engine.addEventListener("onPeerConnect", (details) => {
      const key = `${details.infoHash}:${details.peerId}`;
      this.peers.add(key);
      this.emit({
        type: "peer-connect",
        peerId: details.peerId,
        infoHash: details.infoHash,
        streamType: details.streamType,
        peerCount: this.peers.size,
      });
    });
    engine.addEventListener("onPeerClose", (details) => {
      const key = `${details.infoHash}:${details.peerId}`;
      this.peers.delete(key);
      this.emit({
        type: "peer-close",
        peerId: details.peerId,
        infoHash: details.infoHash,
        streamType: details.streamType,
        peerCount: this.peers.size,
      });
    });
    engine.addEventListener("onChunkDownloaded", (bytesLength, source) => {
      const bytes = finiteNumber(bytesLength);
      if (source === "p2p") {
        this.stats.p2pBytes += bytes;
      } else {
        this.stats.httpBytes += bytes;
      }
    });
    engine.addEventListener("onChunkUploaded", (bytesLength) => {
      this.stats.p2pUploadBytes += finiteNumber(bytesLength);
    });
    engine.addEventListener("onSegmentLoaded", (details) => {
      const source = details.downloadSource === "p2p" ? "p2p" : "http";
      this.stats.segments.total += 1;
      this.stats.segments[source] += 1;
      this.emit({
        type: "segment",
        source,
        bytes: finiteNumber(details.bytesLength),
        peerId: details.peerId || null,
        url: details.segment?.url || details.segmentUrl || null,
        externalId: details.segment?.externalId ?? null,
        streamType: details.streamType,
        infoHash: details.infoHash,
      });
    });
    engine.addEventListener("onSegmentError", (details) => {
      this.stats.segments.errors += 1;
      this.emit({
        type: "segment-error",
        source: details.downloadSource || null,
        peerId: details.peerId || null,
        url: details.segment?.url || null,
        externalId: details.segment?.externalId ?? null,
        streamType: details.streamType,
        infoHash: details.infoHash,
        error: errorDetails(details.error),
      });
    });
    engine.addEventListener("onPeerConnectError", (details) => {
      this.emit({
        type: "peer-error",
        phase: "connect",
        peerId: details.peerId,
        trackerUrl: details.trackerUrl,
        streamType: details.streamType,
        infoHash: details.infoHash,
        error: errorDetails(details.error),
      });
    });
    engine.addEventListener("onPeerError", (details) => {
      this.emit({
        type: "peer-error",
        phase: "connected",
        peerId: details.peerId,
        streamType: details.streamType,
        infoHash: details.infoHash,
        error: errorDetails(details.error),
      });
    });
    engine.addEventListener("onTrackerError", (details) => {
      this.emit({
        type: "tracker-error",
        trackerUrl: details.trackerUrl,
        streamType: details.streamType,
        infoHash: details.infoHash,
        error: errorDetails(details.error),
      });
    });
    engine.addEventListener("onTrackerWarning", (details) => {
      this.emit({
        type: "tracker-warning",
        trackerUrl: details.trackerUrl,
        streamType: details.streamType,
        infoHash: details.infoHash,
        warning: errorDetails(details.warning),
      });
    });
  }

  bindMediaEvents() {
    const events = ["playing", "pause", "waiting", "stalled", "ended", "error"];
    for (const type of events) {
      const listener = () => {
        const mediaError = type === "error" && this.video.error
          ? {
              code: this.video.error.code,
              message: this.video.error.message || "Media element error",
            }
          : null;
        this.emit({
          type: "media",
          state: type,
          mediaError,
        });
        if (type === "playing") {
          this.scheduleRecoveryReset();
        }
        if (type === "error" && this.mode === "native-hls") {
          this.scheduleRecovery({
            source: "native-hls",
            details: `media-error-${mediaError?.code || "unknown"}`,
            error: mediaError,
            restart: () => this.startNativeHls(),
          });
        }
      };
      this.video.addEventListener(type, listener);
      this.mediaListeners.push([type, listener]);
    }
  }

  startStats() {
    this.publishStats();
    this.statsTimer = globalThis.setInterval(() => this.publishStats(), this.statsIntervalMs);
  }

  updatePlaybackStats() {
    this.stats.bufferSeconds = bufferedSeconds(this.video);
    const latency = finiteNumber(this.hls?.latency, Number.NaN);
    this.stats.liveLatencySeconds = Number.isFinite(latency) ? Math.max(0, latency) : null;
    this.stats.peerCount = this.peers.size;
  }

  publishStats() {
    if (this.destroyed) {
      return;
    }
    safeCallback(this.onStats, this.getStats());
  }

  emit(event) {
    safeCallback(this.onEvent, {
      at: Date.now(),
      ...event,
    });
    if (!this.destroyed) {
      this.publishStats();
    }
  }

  scheduleHttpFallback(hls) {
    if (this.recoveryTimer != null || this.terminalFailure) {
      return;
    }
    this.recoveryTimer = globalThis.setTimeout(() => {
      this.recoveryTimer = null;
      if (this.destroyed || this.terminalFailure || this.hls !== hls) {
        return;
      }
      try {
        this.startHls(false, "p2p-runtime-failure");
      } catch (error) {
        this.scheduleRecovery({
          source: "hlsjs",
          details: "http-fallback-initialization-failed",
          error,
          restart: (attempt) => this.startHls(false, `http-recovery-${attempt}`),
        });
      }
    }, 0);
  }

  scheduleRecovery({ source, details, error, restart }) {
    if (this.destroyed || this.terminalFailure || this.recoveryTimer != null) {
      return;
    }
    this.clearRecoveryResetTimer();
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      this.failPlayer({ source, details, error });
      return;
    }
    this.recoveryAttempts += 1;
    const attempt = this.recoveryAttempts;
    const delayMs = Math.min(
      RECOVERY_MAX_DELAY_MS,
      RECOVERY_BASE_DELAY_MS * 2 ** (attempt - 1),
    );
    this.emit({
      type: "recovery-scheduled",
      source,
      details,
      attempt,
      maxAttempts: MAX_RECOVERY_ATTEMPTS,
      delayMs,
      error: errorDetails(error),
    });
    this.recoveryTimer = globalThis.setTimeout(() => {
      this.recoveryTimer = null;
      if (this.destroyed || this.terminalFailure) {
        return;
      }
      try {
        restart(attempt);
      } catch (restartError) {
        this.emit({
          type: "recovery-error",
          source,
          details: "restart-failed",
          attempt,
          error: errorDetails(restartError),
        });
        this.scheduleRecovery({
          source,
          details: "restart-failed",
          error: restartError,
          restart,
        });
      }
    }, delayMs);
  }

  scheduleRecoveryReset() {
    if (
      this.recoveryAttempts === 0 ||
      this.recoveryTimer != null ||
      this.recoveryResetTimer != null
    ) {
      return;
    }
    this.recoveryResetTimer = globalThis.setTimeout(() => {
      this.recoveryResetTimer = null;
      if (!this.destroyed && !this.terminalFailure && !this.video.paused) {
        this.recoveryAttempts = 0;
        this.emit({ type: "recovery-stable" });
      }
    }, RECOVERY_RESET_AFTER_MS);
  }

  clearRecoveryResetTimer() {
    if (this.recoveryResetTimer != null) {
      globalThis.clearTimeout(this.recoveryResetTimer);
      this.recoveryResetTimer = null;
    }
  }

  clearRecoveryTimers() {
    if (this.recoveryTimer != null) {
      globalThis.clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.clearRecoveryResetTimer();
  }

  failPlayer({ source, details, error }) {
    if (this.destroyed || this.terminalFailure) {
      return;
    }
    this.terminalFailure = true;
    this.clearRecoveryTimers();
    this.destroyHls();
    this.peers.clear();
    this.video.pause();
    this.mode = "failed";
    this.emit({
      type: "player-fatal",
      fatal: true,
      source,
      details,
      attempts: this.recoveryAttempts,
      error: errorDetails(error),
    });
  }

  destroyHls() {
    if (!this.hls) {
      return;
    }
    const hls = this.hls;
    this.hls = null;
    hls.destroy();
  }
}

export async function createHybridPlayer(video, options) {
  const player = new HybridPlayer(video, options);
  try {
    await player.start();
    return player;
  } catch (error) {
    player.destroy();
    throw error;
  }
}
