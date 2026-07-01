import React from 'react';
import classnames from 'classnames';
import * as SETTINGS from 'constants/settings';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { doSetClientSetting } from 'redux/actions/settings';
import { selectClientSetting } from 'redux/selectors/settings';
import { selectPrefsReady } from 'redux/selectors/sync';
import {
  fetchLivestreamP2PSignals,
  sendLivestreamP2PSignal,
  useLivestreamP2PCoordination,
  type LivestreamP2PSignal,
} from 'util/hyperbeamLivestreamP2P';
import './style.scss';

type Props = {
  channelId?: string | null;
  claimId?: string | null;
  videoUrl?: string | null;
  active?: boolean;
  discoverable?: boolean;
  trackerUrl?: string | null;
  trackerUrls?: Array<string | null | undefined> | null;
  swarmId?: string | null;
  fallback: React.ReactNode;
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

export default function LivestreamBrowserViewer({
  channelId,
  claimId,
  videoUrl,
  active,
  discoverable,
  trackerUrl,
  trackerUrls,
  swarmId,
  fallback,
}: Props) {
  const dispatch = useAppDispatch();
  const p2pDeliveryEnabled = useAppSelector((state) => selectClientSetting(state, SETTINGS.P2P_DELIVERY));
  const prefsReady = useAppSelector(selectPrefsReady);
  const [enabled, setEnabled] = React.useState(Boolean(p2pDeliveryEnabled));
  const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'waiting' | 'connecting' | 'connected' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const seedPeerIdRef = React.useRef<string | null>(null);
  const processedSignalsRef = React.useRef<Set<string>>(new Set());
  const queuedCandidatesRef = React.useRef<RTCIceCandidateInit[]>([]);

  React.useEffect(() => {
    if (p2pDeliveryEnabled) setEnabled(true);
  }, [p2pDeliveryEnabled]);

  function enableP2P(pushPrefs?: boolean) {
    dispatch(doSetClientSetting(SETTINGS.P2P_DELIVERY, true, pushPrefs));
    setEnabled(true);
  }

  const coordination = useLivestreamP2PCoordination({
    enabled: Boolean((active || discoverable) && enabled && (claimId || channelId || swarmId)),
    role: 'viewer',
    channelId,
    claimId,
    videoUrl,
    trackerUrl,
    trackerUrls,
    swarmId,
  });

  const seedPeerId = React.useMemo(() => {
    const seed = coordination.peers.find((peer) => peerRole(peer) === 'seed' && peerId(peer) !== coordination.peerId);
    return seed ? peerId(seed) : null;
  }, [coordination.peers, coordination.peerId]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = remoteStream;
    if (remoteStream) video.play().catch(() => {});
  }, [remoteStream]);

  const closeConnection = React.useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      try {
        pc.close();
      } catch {}
    }
    pcRef.current = null;
    seedPeerIdRef.current = null;
    queuedCandidatesRef.current = [];
    setRemoteStream(null);
  }, []);

  React.useEffect(() => closeConnection, [closeConnection]);

  React.useEffect(() => {
    if (!active || !enabled || coordination.source !== 'hyperbeam' || !seedPeerId) {
      if (!enabled) setStatus('idle');
      else if (active) setStatus('waiting');
      else setStatus('idle');
      closeConnection();
      return;
    }

    if (seedPeerIdRef.current && seedPeerIdRef.current !== seedPeerId) {
      closeConnection();
      processedSignalsRef.current.clear();
    }

    seedPeerIdRef.current = seedPeerId;
    setStatus((current) => (current === 'connected' ? current : 'waiting'));
  }, [active, closeConnection, coordination.source, enabled, seedPeerId]);

  React.useEffect(() => {
    if (!active || !enabled || coordination.source !== 'hyperbeam' || !coordination.roomId) return;

    let stopped = false;
    const controller = new AbortController();

    const ensureConnection = (fromPeerId: string) => {
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({ iceServers: coordination.iceServers });
      pcRef.current = pc;
      seedPeerIdRef.current = fromPeerId;
      setStatus('connecting');
      setErrorMessage(null);

      pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate) return;
        void sendLivestreamP2PSignal({
          roomId: coordination.roomId,
          fromPeerId: coordination.peerId,
          toPeerId: fromPeerId,
          kind: 'ice-candidate',
          payload: { candidate: event.candidate.toJSON() },
        });
      });
      pc.addEventListener('track', (event) => {
        const [stream] = event.streams;
        if (stream) {
          setRemoteStream(stream);
          setStatus('connected');
        }
      });
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
          setStatus('connected');
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setStatus('failed');
        } else if (pc.connectionState === 'connecting') {
          setStatus('connecting');
        }
      });

      return pc;
    };

    const poll = async () => {
      const signals = await fetchLivestreamP2PSignals(
        { roomId: coordination.roomId, peerId: coordination.peerId },
        controller.signal
      );
      if (stopped) return;

      for (const signal of signals) {
        if (processedSignalsRef.current.has(signal.id)) continue;
        processedSignalsRef.current.add(signal.id);

        try {
          if (signal.kind === 'offer') {
            const description = signalDescription(signal);
            if (!description) continue;
            const pc = ensureConnection(signal.fromPeerId);
            await pc.setRemoteDescription(new RTCSessionDescription(description));

            for (const candidate of queuedCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            queuedCandidatesRef.current = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendLivestreamP2PSignal({
              roomId: coordination.roomId,
              fromPeerId: coordination.peerId,
              toPeerId: signal.fromPeerId,
              kind: 'answer',
              payload: { description: answer },
            });
          } else if (signal.kind === 'ice-candidate') {
            const candidate = signalCandidate(signal);
            if (!candidate) continue;
            const pc = pcRef.current;
            if (!pc || !pc.remoteDescription) {
              queuedCandidatesRef.current.push(candidate);
            } else {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
          }
        } catch (e: any) {
          setErrorMessage(e?.message || __('P2P connection failed.'));
          setStatus('failed');
        }
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 1000);

    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [
    active,
    coordination.iceServers,
    coordination.peerId,
    coordination.roomId,
    coordination.source,
    enabled,
  ]);

  const connected = status === 'connected' && Boolean(remoteStream);
  const hasBrowserLiveSource = Boolean((active || discoverable) && !videoUrl);
  const browserP2PSupported = typeof RTCPeerConnection !== 'undefined';
  const canOfferP2P = Boolean(
    hasBrowserLiveSource && !enabled && !p2pDeliveryEnabled && browserP2PSupported
  );
  const showStandaloneState = Boolean(hasBrowserLiveSource && !connected);
  const showOverlay = Boolean(active && enabled && !showStandaloneState && (status !== 'idle' || !remoteStream));
  const stateTitle = canOfferP2P
    ? __('P2P streaming available')
    : !browserP2PSupported
      ? __('Browser stream unsupported')
      : status === 'failed'
        ? __('Browser stream unavailable')
        : status === 'connecting'
          ? __('Connecting through HyperBEAM')
          : __('Waiting for browser stream');
  const stateDetail = canOfferP2P
    ? __('Watch this live browser stream through HyperBEAM peer coordination.')
    : !browserP2PSupported
      ? __('This browser cannot open WebRTC livestreams.')
      : status === 'failed'
        ? errorMessage || __('The browser stream could not be reached. It may have ended.')
        : status === 'connecting'
          ? __('Looking for the streamer peer and negotiating WebRTC.')
          : coordination.source === 'hyperbeam'
            ? __('The livestream claim is live. Waiting for the streamer peer to publish media.')
            : __('Connecting to HyperBEAM room signaling.');

  return (
    <div
      className={classnames('livestream-browser-viewer', { 'livestream-browser-viewer--connected': connected })}
      data-testid="livestream-browser-viewer"
      data-room-id={coordination.roomId || undefined}
      data-swarm-id={coordination.swarmId || undefined}
      data-source={coordination.source}
    >
      {connected ? (
        <video ref={videoRef} className="livestream-browser-viewer__video" autoPlay playsInline controls />
      ) : showStandaloneState ? (
        <div className="livestream-browser-viewer__standby">
          <div className="livestream-browser-viewer__standby-signal">
            <span />
          </div>
          <div className="livestream-browser-viewer__standby-copy">
            <strong>{stateTitle}</strong>
            <span>{stateDetail}</span>
          </div>
          {canOfferP2P && (
            <div className="livestream-browser-viewer__standby-actions">
              <button
                type="button"
                className="livestream-browser-viewer__standby-button livestream-browser-viewer__standby-button--primary"
                onClick={() => enableP2P()}
              >
                {__('Try it')}
              </button>
              <button
                type="button"
                className="livestream-browser-viewer__standby-button"
                onClick={() => enableP2P(prefsReady)}
              >
                {__('Always')}
              </button>
            </div>
          )}
        </div>
      ) : (
        fallback
      )}
      {showOverlay && (
        <div className="livestream-browser-viewer__overlay">
          <div>
            <strong>{__('HyperBEAM P2P')}</strong>
            <span>
              {status === 'connected' && __('Connected')}
              {status === 'connecting' && __('Connecting')}
              {status === 'waiting' && __('Waiting for browser seed')}
              {status === 'failed' && (errorMessage || __('P2P unavailable'))}
              {status === 'idle' && __('Starting')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
