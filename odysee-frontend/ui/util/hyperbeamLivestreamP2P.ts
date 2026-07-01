import React from 'react';
import { getLivestreamTurnServer } from 'constants/livestream';
import { HYPERBEAM_DEVICE, hyperbeamDeviceBase } from 'util/hyperbeamDevices';

type LivestreamP2PRole = 'seed' | 'viewer';

type LivestreamP2POptions = {
  enabled?: boolean;
  role: LivestreamP2PRole;
  peerId?: string | null;
  roomId?: string | null;
  channelId?: string | null;
  claimId?: string | null;
  videoUrl?: string | null;
  trackerUrl?: string | null;
  trackerUrls?: Array<string | null | undefined> | null;
  swarmId?: string | null;
};

export type LivestreamP2PCoordination = {
  trackerUrls: string[];
  signalingUrl: string | null;
  swarmId: string | null;
  iceServers: RTCIceServer[];
  peerId: string;
  roomId: string | null;
  source: 'metadata' | 'hyperbeam';
  heartbeatMs: number;
  peers: Array<Record<string, any>>;
};

export type LivestreamP2PSignalKind = 'offer' | 'answer' | 'ice-candidate';

export type LivestreamP2PSignal = {
  id: string;
  kind: LivestreamP2PSignalKind | string;
  fromPeerId: string;
  toPeerId: string | null;
  payload: any;
  createdAt: number | null;
};

const DEFAULT_HEARTBEAT_MS = 30000;
const DISCOVERY_HEARTBEAT_MS = 1000;
const DISCOVERY_WINDOW_MS = 10000;

export function getDefaultLivestreamP2PIceServers(): RTCIceServer[] {
  const turnServer = getLivestreamTurnServer();
  return turnServer ? [turnServer] : [];
}

function randomPeerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `odysee-${crypto.randomUUID()}`;
  }
  return `odysee-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function roomIdFromOptions(options: LivestreamP2POptions) {
  return options.roomId || options.swarmId || options.claimId || options.channelId || null;
}

function fallbackSwarmId(options: LivestreamP2POptions) {
  if (options.swarmId) return options.swarmId;
  const roomId = roomIdFromOptions(options);
  return roomId ? `odysee-live-${roomId}` : null;
}

function normalizeTrackerUrls(values: Array<any>): string[] {
  const urls = values.flatMap((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return normalizeTrackerUrls(value);
    if (typeof value === 'string') return value.split(',').map((part) => part.trim());
    return [];
  });
  return Array.from(new Set(urls.filter(Boolean)));
}

function normalizeIceServers(value: any, fallback: RTCIceServer[]): RTCIceServer[] {
  if (!Array.isArray(value)) return fallback;
  const servers = value
    .map((server) => {
      if (!server) return null;
      if (typeof server === 'string') return { urls: server };
      if (typeof server === 'object' && server.urls) return server;
      return null;
    })
    .filter(Boolean) as RTCIceServer[];
  return servers.length ? servers : fallback;
}

function normalizeSignal(signal: any): LivestreamP2PSignal | null {
  if (!signal || typeof signal !== 'object') return null;
  const id = signal.id || signal['signal-id'] || signal.signal_id;
  const fromPeerId = signal.from_peer_id || signal['from-peer-id'];
  const kind = signal.kind || signal.type;
  if (!id || !fromPeerId || !kind) return null;
  return {
    id,
    kind,
    fromPeerId,
    toPeerId: signal.to_peer_id || signal['to-peer-id'] || null,
    payload: signal.payload || {},
    createdAt: Number(signal.created_at || signal['created-at'] || 0) || null,
  };
}

function livestreamP2PBase() {
  return hyperbeamDeviceBase(HYPERBEAM_DEVICE.livestreamP2P);
}

export function fallbackLivestreamP2PConfig(options: LivestreamP2POptions): LivestreamP2PCoordination {
  const trackerUrls = normalizeTrackerUrls([options.trackerUrls, options.trackerUrl]);
  return {
    trackerUrls,
    signalingUrl: livestreamP2PBase(),
    swarmId: fallbackSwarmId(options),
    iceServers: getDefaultLivestreamP2PIceServers(),
    peerId: options.peerId || randomPeerId(),
    roomId: roomIdFromOptions(options),
    source: 'metadata',
    heartbeatMs: DEFAULT_HEARTBEAT_MS,
    peers: [],
  };
}

async function announceHyperbeamLivestreamP2P(
  options: LivestreamP2POptions,
  fallback: LivestreamP2PCoordination,
  signal?: AbortSignal
): Promise<LivestreamP2PCoordination> {
  const base = livestreamP2PBase();
  if (!base || !fallback.roomId) return fallback;

  const response = await fetch(`${base}/announce`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      room_id: fallback.roomId,
      channel_id: options.channelId || undefined,
      claim_id: options.claimId || undefined,
      video_url: options.videoUrl || undefined,
      role: options.role,
      peer_id: fallback.peerId,
      swarm_id: fallback.swarmId || undefined,
      tracker_urls: fallback.trackerUrls.length ? fallback.trackerUrls : undefined,
    }),
    signal,
  });

  if (!response.ok) return fallback;

  const data = await response.json();
  const trackerUrls = normalizeTrackerUrls([data.tracker_urls, data['tracker-urls'], fallback.trackerUrls]);

  return {
    trackerUrls: trackerUrls.length ? trackerUrls : fallback.trackerUrls,
    signalingUrl: base,
    swarmId: data.swarm_id || data['swarm-id'] || fallback.swarmId,
    iceServers: normalizeIceServers(data.ice_servers || data['ice-servers'], fallback.iceServers),
    peerId: data.peer_id || data['peer-id'] || fallback.peerId,
    roomId: data.room_id || data['room-id'] || fallback.roomId,
    source: 'hyperbeam',
    heartbeatMs: Number(data.heartbeat_ms || data['heartbeat-ms'] || fallback.heartbeatMs) || fallback.heartbeatMs,
    peers: Array.isArray(data.peers) ? data.peers : [],
  };
}

function leaveHyperbeamLivestreamP2P(config: LivestreamP2PCoordination) {
  const base = livestreamP2PBase();
  if (!base || !config.roomId || !config.peerId || config.source !== 'hyperbeam') return;

  fetch(`${base}/leave`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      room_id: config.roomId,
      peer_id: config.peerId,
    }),
    keepalive: true,
  }).catch(() => {});
}

export async function sendLivestreamP2PSignal(
  options: {
    roomId: string | null;
    fromPeerId: string;
    toPeerId?: string | null;
    kind: LivestreamP2PSignalKind;
    payload: any;
  },
  signal?: AbortSignal
): Promise<LivestreamP2PSignal | null> {
  const base = livestreamP2PBase();
  if (!base || !options.roomId || !options.fromPeerId) return null;
  try {
    const response = await fetch(`${base}/signal`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        room_id: options.roomId,
        from_peer_id: options.fromPeerId,
        to_peer_id: options.toPeerId || undefined,
        kind: options.kind,
        payload: options.payload,
      }),
      signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeSignal(data.signal);
  } catch {
    return null;
  }
}

export async function fetchLivestreamP2PSignals(
  options: {
    roomId: string | null;
    peerId: string;
  },
  signal?: AbortSignal
): Promise<LivestreamP2PSignal[]> {
  const base = livestreamP2PBase();
  if (!base || !options.roomId || !options.peerId) return [];
  try {
    const response = await fetch(`${base}/signals`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        room_id: options.roomId,
        peer_id: options.peerId,
      }),
      signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.signals) ? data.signals.map(normalizeSignal).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function useLivestreamP2PCoordination(options: LivestreamP2POptions): LivestreamP2PCoordination {
  const optionsKey = [
    options.enabled ? '1' : '0',
    options.role,
    options.peerId || '',
    options.roomId || '',
    options.channelId || '',
    options.claimId || '',
    options.videoUrl || '',
    options.trackerUrl || '',
    (options.trackerUrls || []).join('|'),
    options.swarmId || '',
  ].join('::');
  const fallback = React.useMemo(() => fallbackLivestreamP2PConfig(options), [optionsKey]);
  const [config, setConfig] = React.useState(fallback);

  React.useEffect(() => {
    setConfig(fallback);
  }, [fallback]);

  React.useEffect(() => {
    if (!options.enabled || !fallback.roomId) return;

    const controller = new AbortController();
    let stopped = false;
    let intervalId: number | null = null;
    let discoveryIntervalId: number | null = null;
    let discoveryTimeoutId: number | null = null;
    let latestConfig = fallback;

    const announce = () => {
      announceHyperbeamLivestreamP2P(options, fallback, controller.signal)
        .then((next) => {
          latestConfig = next;
          if (!stopped) setConfig(next);
        })
        .catch(() => {
          if (!stopped) setConfig(fallback);
        });
    };

    announce();
    discoveryIntervalId = window.setInterval(announce, DISCOVERY_HEARTBEAT_MS);
    discoveryTimeoutId = window.setTimeout(() => {
      if (discoveryIntervalId) window.clearInterval(discoveryIntervalId);
      discoveryIntervalId = null;
    }, DISCOVERY_WINDOW_MS);
    intervalId = window.setInterval(announce, fallback.heartbeatMs);

    return () => {
      stopped = true;
      controller.abort();
      if (intervalId) window.clearInterval(intervalId);
      if (discoveryIntervalId) window.clearInterval(discoveryIntervalId);
      if (discoveryTimeoutId) window.clearTimeout(discoveryTimeoutId);
      leaveHyperbeamLivestreamP2P(latestConfig);
    };
  }, [fallback, options.enabled, optionsKey]);

  return config;
}
