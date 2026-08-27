import { analyticsTrackingEnabled, sendAnalyticsEngagement } from 'analytics/hyperbeam';
import type { EngagementEvent, EngagementInput } from 'analytics/hyperbeam';

const HEARTBEAT_INTERVAL_MS = 10_000;

type MediaPlayer = {
  currentTime?: number | (() => number);
  seeking?: boolean | (() => boolean);
};

type PlaybackState = {
  subjectId: string;
  interactionId: string;
  player: MediaPlayer;
  sequence: number;
  activeMs: number;
  positionMs: number;
  activeSince: number | null;
  heartbeat: number | null;
  outbox: EngagementInput[];
  flushing: boolean;
};

let enabled = false;
let playback: PlaybackState | null = null;

function randomInteractionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function playerNumber(player: MediaPlayer, key: 'currentTime') {
  const value = player[key];
  const number = typeof value === 'function' ? value.call(player) : value;
  return Number.isFinite(number) ? Number(number) : 0;
}

function playerIsSeeking(player: MediaPlayer) {
  const value = player.seeking;
  return Boolean(typeof value === 'function' ? value.call(player) : value);
}

function settleActiveTime(state: PlaybackState) {
  if (state.activeSince !== null) {
    state.activeMs += Math.max(0, Date.now() - state.activeSince);
    state.activeSince = Date.now();
  }

  state.positionMs = Math.max(state.positionMs, Math.round(playerNumber(state.player, 'currentTime') * 1000));
}

async function flushOutbox(state: PlaybackState, keepalive = false) {
  if (state.flushing || !enabled || !analyticsTrackingEnabled()) return;

  state.flushing = true;
  try {
    while (state.outbox.length > 0) {
      await sendAnalyticsEngagement(state.outbox[0], keepalive);
      state.outbox.shift();
    }
  } catch (_) {
    // Keep the event queued. The next lifecycle event retries it in order.
  } finally {
    state.flushing = false;
  }
}

function queueEvent(state: PlaybackState, event: EngagementEvent, keepalive = false) {
  state.sequence += 1;
  state.outbox.push({
    subjectId: state.subjectId,
    interactionId: state.interactionId,
    event,
    sequence: state.sequence,
    activeMs: Math.round(state.activeMs),
    positionMs: state.positionMs,
  });
  void flushOutbox(state, keepalive);
}

function stopHeartbeat(state: PlaybackState) {
  if (state.heartbeat !== null) {
    window.clearInterval(state.heartbeat);
    state.heartbeat = null;
  }
}

function sendHeartbeat(state: PlaybackState) {
  settleActiveTime(state);
  queueEvent(state, 'heartbeat');
}

function startHeartbeat(state: PlaybackState) {
  if (state.heartbeat !== null) return;
  state.heartbeat = window.setInterval(() => sendHeartbeat(state), HEARTBEAT_INTERVAL_MS);
}

function endPlayback() {
  const state = playback;
  if (!state) return;

  settleActiveTime(state);
  stopHeartbeat(state);
  state.activeSince = null;
  queueEvent(state, 'end', true);
  playback = null;
}

function completePlayback() {
  const state = playback;
  if (!state) return;

  settleActiveTime(state);
  stopHeartbeat(state);
  state.activeSince = null;
  queueEvent(state, 'complete', true);
  playback = null;
}

export type Watchman = {
  setState: (enable: boolean) => void;
  videoStartEvent: (
    arg0: string | null | undefined,
    arg1: number,
    arg2: string,
    arg3: number | null | undefined,
    arg4: string,
    arg5: MediaPlayer,
    arg6: number | null | undefined,
    arg7: boolean,
    arg8?: boolean
  ) => void;
  videoIsPlaying: (arg0: boolean, arg1: MediaPlayer | null | undefined) => void;
  videoCompleteEvent: () => void;
  videoBufferEvent: (
    arg0: StreamClaim,
    arg1: {
      timeAtBuffer: number;
      bufferDuration: number;
      bitRate: number;
      duration: number;
      userId: string;
      playerPoweredBy: string;
      readyState: number;
      isLivestream: boolean;
    }
  ) => Promise<void>;
  onDispose: () => void;
};

export const watchman: Watchman = {
  setState: (value) => {
    if (!value) endPlayback();
    enabled = value;
  },

  videoIsPlaying: (isPlaying, passedPlayer) => {
    const state = playback;
    if (!state) return;
    if (passedPlayer) state.player = passedPlayer;

    const seeking = playerIsSeeking(state.player);
    if (!isPlaying && !seeking) {
      settleActiveTime(state);
      state.activeSince = null;
      stopHeartbeat(state);
      queueEvent(state, 'pause');
    } else if (isPlaying && state.activeSince === null) {
      state.activeSince = Date.now();
      startHeartbeat(state);
    }
  },

  // Buffer diagnostics are intentionally not sent to the legacy Watchman
  // service. Playback qualification is based on monotonic active duration.
  videoBufferEvent: async () => {},

  videoCompleteEvent: completePlayback,

  videoStartEvent: (
    claimId,
    _timeToStartVideo,
    _poweredBy,
    _userId,
    _canonicalUrl,
    player,
    _videoBitrate,
    isLivestream,
    isPreview
  ) => {
    if (!enabled || !analyticsTrackingEnabled() || !claimId || isLivestream || isPreview) return;

    endPlayback();
    playback = {
      subjectId: claimId,
      interactionId: randomInteractionId(),
      player,
      sequence: -1,
      activeMs: 0,
      positionMs: Math.max(0, Math.round(playerNumber(player, 'currentTime') * 1000)),
      activeSince: Date.now(),
      heartbeat: null,
      outbox: [],
      flushing: false,
    };
    queueEvent(playback, 'start');
    startHeartbeat(playback);
  },

  onDispose: endPlayback,
};
