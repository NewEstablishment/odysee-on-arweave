import React from 'react';
import {
  fetchLivestreamP2PSignals,
  sendLivestreamP2PSignal,
  type LivestreamP2PCoordination,
  type LivestreamP2PSignal,
} from 'util/hyperbeamLivestreamP2P';

type Props = {
  active: boolean;
  mediaStream: MediaStream | null;
  coordination: LivestreamP2PCoordination;
  onViewerCount?: (count: number) => void;
};

function peerId(peer: Record<string, any>) {
  return peer.peer_id || peer['peer-id'] || peer.id || '';
}

function peerRole(peer: Record<string, any>) {
  return peer.role || 'peer';
}

function signalDescription(signal: LivestreamP2PSignal) {
  return signal.payload?.description || signal.payload?.offer || signal.payload?.answer || signal.payload;
}

function signalCandidate(signal: LivestreamP2PSignal) {
  return signal.payload?.candidate || signal.payload;
}

export default function LivestreamBrowserRelay({ active, mediaStream, coordination, onViewerCount }: Props) {
  const peersRef = React.useRef<Map<string, RTCPeerConnection>>(new Map());
  const processedSignalsRef = React.useRef<Set<string>>(new Set());

  const viewerIds = React.useMemo(
    () =>
      coordination.peers
        .filter((peer) => peerRole(peer) === 'viewer')
        .map(peerId)
        .filter((id) => id && id !== coordination.peerId),
    [coordination.peers, coordination.peerId]
  );
  const viewerKey = viewerIds.join('|');
  const streamKey = mediaStream?.getTracks().map((track) => track.id).join('|') || '';
  const iceKey = coordination.iceServers
    .map((server) => (Array.isArray(server.urls) ? server.urls.join(',') : server.urls || ''))
    .join('|');

  const closePeer = React.useCallback((id: string) => {
    const pc = peersRef.current.get(id);
    if (pc) {
      try {
        pc.close();
      } catch {}
    }
    peersRef.current.delete(id);
  }, []);

  const closeAllPeers = React.useCallback(() => {
    Array.from(peersRef.current.keys()).forEach(closePeer);
    onViewerCount?.(0);
  }, [closePeer, onViewerCount]);

  React.useEffect(() => {
    closeAllPeers();
    processedSignalsRef.current.clear();
  }, [closeAllPeers, coordination.peerId, coordination.roomId, coordination.source, iceKey, streamKey]);

  React.useEffect(() => {
    if (!active || !mediaStream || coordination.source !== 'hyperbeam' || !coordination.roomId) {
      closeAllPeers();
      return;
    }

    const wantedViewers = new Set(viewerIds);
    Array.from(peersRef.current.keys()).forEach((id) => {
      if (!wantedViewers.has(id)) closePeer(id);
    });

    viewerIds.forEach((viewerPeerId) => {
      if (peersRef.current.has(viewerPeerId)) return;

      const pc = new RTCPeerConnection({ iceServers: coordination.iceServers });
      peersRef.current.set(viewerPeerId, pc);
      mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));
      pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate) return;
        void sendLivestreamP2PSignal({
          roomId: coordination.roomId,
          fromPeerId: coordination.peerId,
          toPeerId: viewerPeerId,
          kind: 'ice-candidate',
          payload: { candidate: event.candidate.toJSON() },
        });
      });
      pc.addEventListener('connectionstatechange', () => {
        const connected = Array.from(peersRef.current.values()).filter((candidate) =>
          candidate.connectionState === 'connected' || ['connected', 'completed'].includes(candidate.iceConnectionState)
        );
        onViewerCount?.(connected.length);
      });

      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) =>
          sendLivestreamP2PSignal({
            roomId: coordination.roomId,
            fromPeerId: coordination.peerId,
            toPeerId: viewerPeerId,
            kind: 'offer',
            payload: { description: offer },
          })
        )
        .catch(() => closePeer(viewerPeerId));
    });
  }, [
    active,
    closeAllPeers,
    closePeer,
    coordination.peerId,
    coordination.roomId,
    coordination.source,
    iceKey,
    mediaStream,
    onViewerCount,
    streamKey,
    viewerKey,
  ]);

  React.useEffect(() => closeAllPeers, [closeAllPeers]);

  React.useEffect(() => {
    if (!active || coordination.source !== 'hyperbeam' || !coordination.roomId) return;

    let stopped = false;
    const controller = new AbortController();

    const poll = async () => {
      const signals = await fetchLivestreamP2PSignals(
        { roomId: coordination.roomId, peerId: coordination.peerId },
        controller.signal
      );
      if (stopped) return;

      for (const signal of signals) {
        if (processedSignalsRef.current.has(signal.id)) continue;
        processedSignalsRef.current.add(signal.id);
        const pc = peersRef.current.get(signal.fromPeerId);
        if (!pc) continue;

        try {
          if (signal.kind === 'answer') {
            const description = signalDescription(signal);
            if (description && pc.signalingState !== 'stable') {
              await pc.setRemoteDescription(new RTCSessionDescription(description));
            }
          } else if (signal.kind === 'ice-candidate') {
            const candidate = signalCandidate(signal);
            if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch {}
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 1000);

    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [active, coordination.peerId, coordination.roomId, coordination.source]);

  return null;
}
