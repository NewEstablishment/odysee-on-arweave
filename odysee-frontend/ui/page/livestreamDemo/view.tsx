import React from 'react';
import Page from 'component/page';
import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import {
  fetchLivestreamP2PSignals,
  sendLivestreamP2PSignal,
  useLivestreamP2PCoordination,
  type LivestreamP2PCoordination,
  type LivestreamP2PSignal,
  type LivestreamP2PSignalKind,
} from 'util/hyperbeamLivestreamP2P';
import './style.scss';

const ROOM_PREFIX = 'browser-demo';

type DemoStatus = 'idle' | 'starting' | 'signaling' | 'connected' | 'failed';

type DemoSession = {
  seedPc: RTCPeerConnection;
  viewerPc: RTCPeerConnection;
  seedSeen: Set<string>;
  viewerSeen: Set<string>;
  seedCandidates: RTCIceCandidateInit[];
  viewerCandidates: RTCIceCandidateInit[];
  pollId: number | null;
  localStream: MediaStream;
  stopGenerated?: () => void;
};

function makeRoomId() {
  return `${ROOM_PREFIX}-${Math.random().toString(36).slice(2, 7)}`;
}

function peerKey(peer: Record<string, any>) {
  return peer.peer_id || peer['peer-id'] || peer.id || '';
}

function peerRole(peer: Record<string, any>) {
  return peer.role || 'peer';
}

function peerExpiry(peer: Record<string, any>) {
  const expiresAt = Number(peer.expires_at || peer['expires-at'] || 0);
  if (!expiresAt) return 'active';
  const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  return `${remaining}s`;
}

function compactId(value: string | null | undefined) {
  if (!value) return 'none';
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function uniquePeers(configs: LivestreamP2PCoordination[]) {
  const peers = new Map<string, Record<string, any>>();
  configs.forEach((config) => {
    config.peers.forEach((peer) => {
      const key = peerKey(peer);
      if (key) peers.set(key, peer);
    });
  });
  return Array.from(peers.values());
}

function createGeneratedVideoStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  let frame = 0;
  let rafId = 0;

  function draw() {
    if (!ctx) return;
    const hue = (frame * 2) % 360;
    ctx.fillStyle = `hsl(${hue}, 72%, 42%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(72, 72, canvas.width - 144, canvas.height - 144);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 78px sans-serif';
    ctx.fillText('HyperBEAM P2P', 112, 180);
    ctx.font = '500 38px sans-serif';
    ctx.fillText(`Frame ${frame}`, 112, 250);
    ctx.fillText(new Date().toLocaleTimeString(), 112, 312);
    ctx.beginPath();
    ctx.arc(1020 + Math.sin(frame / 18) * 120, 360 + Math.cos(frame / 24) * 120, 72, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    frame += 1;
    rafId = window.requestAnimationFrame(draw);
  }

  draw();
  const stream = canvas.captureStream(24);
  return {
    stream,
    stop: () => {
      window.cancelAnimationFrame(rafId);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

function descriptionPayload(description: RTCSessionDescription | null) {
  return description ? { type: description.type, sdp: description.sdp } : null;
}

function LivestreamP2PDemoPage() {
  const [roomId, setRoomId] = React.useState(() => makeRoomId());
  const [status, setStatus] = React.useState<DemoStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(null);
  const [stats, setStats] = React.useState({
    sentSignals: 0,
    receivedSignals: 0,
    offers: 0,
    answers: 0,
    candidates: 0,
    seedState: 'new',
    viewerState: 'new',
  });
  const seedVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const viewerVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const sessionRef = React.useRef<DemoSession | null>(null);
  const swarmId = `odysee-live-${roomId || ROOM_PREFIX}`;
  const seed = useLivestreamP2PCoordination({
    enabled: true,
    role: 'seed',
    claimId: roomId || ROOM_PREFIX,
    swarmId,
  });
  const viewer = useLivestreamP2PCoordination({
    enabled: true,
    role: 'viewer',
    claimId: roomId || ROOM_PREFIX,
    swarmId,
  });
  const peers = uniquePeers([seed, viewer]);
  const hyperbeamOnline = seed.source === 'hyperbeam' && viewer.source === 'hyperbeam';
  const signalingUrl = seed.signalingUrl || viewer.signalingUrl;
  const iceServers = seed.iceServers.length ? seed.iceServers : viewer.iceServers;
  const rtcConnected = status === 'connected';

  const stopVideo = React.useCallback(() => {
    const session = sessionRef.current;
    if (session?.pollId) window.clearInterval(session.pollId);
    session?.seedPc.close();
    session?.viewerPc.close();
    session?.stopGenerated?.();
    session?.localStream.getTracks().forEach((track) => track.stop());
    sessionRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setError(null);
    setStats({
      sentSignals: 0,
      receivedSignals: 0,
      offers: 0,
      answers: 0,
      candidates: 0,
      seedState: 'new',
      viewerState: 'new',
    });
  }, []);

  React.useEffect(() => () => stopVideo(), [stopVideo]);

  React.useEffect(() => {
    if (seedVideoRef.current) seedVideoRef.current.srcObject = localStream;
  }, [localStream]);

  React.useEffect(() => {
    if (viewerVideoRef.current) viewerVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  function setRoom(value: string) {
    if (sessionRef.current) stopVideo();
    setRoomId(value);
  }

  function refreshRoom() {
    stopVideo();
    setRoomId(makeRoomId());
  }

  async function publishSignal(
    kind: LivestreamP2PSignalKind,
    fromPeerId: string,
    toPeerId: string,
    payload: any
  ) {
    await sendLivestreamP2PSignal({
      roomId: seed.roomId || viewer.roomId || roomId,
      fromPeerId,
      toPeerId,
      kind,
      payload,
    });
    setStats((current) => ({
      ...current,
      sentSignals: current.sentSignals + 1,
      candidates: kind === 'ice-candidate' ? current.candidates + 1 : current.candidates,
    }));
  }

  async function flushCandidates(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
    while (queue.length && pc.remoteDescription) {
      const candidate = queue.shift();
      if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function handleSignals(
    config: LivestreamP2PCoordination,
    pc: RTCPeerConnection,
    seen: Set<string>,
    candidateQueue: RTCIceCandidateInit[]
  ) {
    const signals = await fetchLivestreamP2PSignals({ roomId: config.roomId, peerId: config.peerId });
    for (const signal of signals) {
      if (seen.has(signal.id)) continue;
      seen.add(signal.id);
      await handleSignal(signal, pc, candidateQueue, config.peerId);
    }
  }

  async function handleSignal(
    signal: LivestreamP2PSignal,
    pc: RTCPeerConnection,
    candidateQueue: RTCIceCandidateInit[],
    receiverPeerId: string
  ) {
    setStats((current) => ({
      ...current,
      receivedSignals: current.receivedSignals + 1,
      offers: signal.kind === 'offer' ? current.offers + 1 : current.offers,
      answers: signal.kind === 'answer' ? current.answers + 1 : current.answers,
      candidates: signal.kind === 'ice-candidate' ? current.candidates + 1 : current.candidates,
    }));

    if (signal.kind === 'offer' && receiverPeerId === viewer.peerId) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
      await flushCandidates(pc, candidateQueue);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await publishSignal('answer', viewer.peerId, signal.fromPeerId, {
        description: descriptionPayload(pc.localDescription),
      });
      return;
    }

    if (signal.kind === 'answer' && receiverPeerId === seed.peerId) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
      await flushCandidates(pc, candidateQueue);
      return;
    }

    if (signal.kind === 'ice-candidate' && signal.payload?.candidate) {
      if (!pc.remoteDescription) {
        candidateQueue.push(signal.payload.candidate);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(signal.payload.candidate));
    }
  }

  async function startVideo(source: 'generated' | 'camera') {
    stopVideo();
    setStatus('starting');
    setError(null);

    try {
      if (!hyperbeamOnline) throw new Error('HyperBEAM signaling is not online yet.');
      const generated = source === 'generated' ? createGeneratedVideoStream() : null;
      const stream =
        generated?.stream ||
        (await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        }));
      const rtcConfig = { iceServers };
      const seedPc = new RTCPeerConnection(rtcConfig);
      const viewerPc = new RTCPeerConnection(rtcConfig);
      const session: DemoSession = {
        seedPc,
        viewerPc,
        seedSeen: new Set(),
        viewerSeen: new Set(),
        seedCandidates: [],
        viewerCandidates: [],
        pollId: null,
        localStream: stream,
        stopGenerated: generated?.stop,
      };
      sessionRef.current = session;

      stream.getTracks().forEach((track) => seedPc.addTrack(track, stream));
      setLocalStream(stream);

      viewerPc.ontrack = (event) => {
        const [remote] = event.streams;
        setRemoteStream(remote || new MediaStream([event.track]));
      };
      seedPc.onicecandidate = (event) => {
        if (event.candidate) {
          publishSignal('ice-candidate', seed.peerId, viewer.peerId, { candidate: event.candidate.toJSON() });
        }
      };
      viewerPc.onicecandidate = (event) => {
        if (event.candidate) {
          publishSignal('ice-candidate', viewer.peerId, seed.peerId, { candidate: event.candidate.toJSON() });
        }
      };
      seedPc.onconnectionstatechange = () => {
        const next = seedPc.connectionState;
        setStats((current) => ({ ...current, seedState: next }));
        if (next === 'connected') setStatus('connected');
        if (next === 'failed') setStatus('failed');
      };
      viewerPc.onconnectionstatechange = () => {
        const next = viewerPc.connectionState;
        setStats((current) => ({ ...current, viewerState: next }));
        if (next === 'connected') setStatus('connected');
        if (next === 'failed') setStatus('failed');
      };

      const poll = () => {
        const current = sessionRef.current;
        if (!current) return;
        Promise.all([
          handleSignals(seed, current.seedPc, current.seedSeen, current.seedCandidates),
          handleSignals(viewer, current.viewerPc, current.viewerSeen, current.viewerCandidates),
        ]).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('failed');
        });
      };

      session.pollId = window.setInterval(poll, 700);
      const offer = await seedPc.createOffer();
      await seedPc.setLocalDescription(offer);
      await publishSignal('offer', seed.peerId, viewer.peerId, {
        description: descriptionPayload(seedPc.localDescription),
      });
      setStatus('signaling');
      poll();
    } catch (err) {
      stopVideo();
      setStatus('failed');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Page fullWidthPage noFooter>
      <main className="livestream-demo">
        <section className="livestream-demo__hero">
          <div>
            <p className="livestream-demo__eyebrow">{__('HyperBEAM livestream coordination')}</p>
            <h1>{__('Livestream P2P Demo')}</h1>
            <p className="livestream-demo__lede">
              {__('Public browser session with HyperBEAM room signaling and a real WebRTC media path.')}
            </p>
          </div>
          <div className={hyperbeamOnline ? 'livestream-demo__status is-online' : 'livestream-demo__status'}>
            <span />
            {hyperbeamOnline ? __('HyperBEAM signaling online') : __('Signaling fallback')}
          </div>
        </section>

        <section className="livestream-demo__workspace">
          <div className="livestream-demo__controls">
            <label>
              <span>{__('Room')}</span>
              <input value={roomId} onChange={(event) => setRoom(event.target.value)} />
            </label>
            <div className="livestream-demo__actions">
              <button type="button" onClick={() => startVideo('generated')} disabled={!hyperbeamOnline}>
                {__('Start test feed')}
              </button>
              <button type="button" onClick={() => startVideo('camera')} disabled={!hyperbeamOnline}>
                {__('Start camera')}
              </button>
              <button type="button" onClick={stopVideo} disabled={!sessionRef.current}>
                {__('Stop')}
              </button>
              <button type="button" onClick={refreshRoom}>
                {__('New room')}
              </button>
            </div>
          </div>

          {error && <div className="livestream-demo__error">{error}</div>}

          <div className="livestream-demo__video-grid">
            <MediaPanel title={__('Seed video')} videoRef={seedVideoRef} muted active={Boolean(localStream)} />
            <MediaPanel title={__('Viewer video')} videoRef={viewerVideoRef} active={Boolean(remoteStream)} />
          </div>

          <div className="livestream-demo__grid">
            <PeerPanel title={__('Seed')} config={seed} testId="livestream-demo-peer-seed" />
            <PeerPanel title={__('Viewer')} config={viewer} testId="livestream-demo-peer-viewer" />
          </div>

          <div className="livestream-demo__details">
            <section>
              <h2>{__('Swarm')}</h2>
              <dl>
                <div>
                  <dt>{__('Room')}</dt>
                  <dd>{seed.roomId || viewer.roomId || roomId}</dd>
                </div>
                <div>
                  <dt>{__('Swarm ID')}</dt>
                  <dd>{seed.swarmId || viewer.swarmId || swarmId}</dd>
                </div>
                <div>
                  <dt>{__('Node')}</dt>
                  <dd>{ODYSEE_HYPERBEAM_NODE_API || __('not configured')}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h2>{__('WebRTC')}</h2>
              <dl>
                <div>
                  <dt>{__('Media')}</dt>
                  <dd>{rtcConnected ? __('connected') : status}</dd>
                </div>
                <div>
                  <dt>{__('Seed ICE')}</dt>
                  <dd>{stats.seedState}</dd>
                </div>
                <div>
                  <dt>{__('Viewer ICE')}</dt>
                  <dd>{stats.viewerState}</dd>
                </div>
                <div>
                  <dt>{__('Signals')}</dt>
                  <dd>
                    {stats.sentSignals}/{stats.receivedSignals}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="livestream-demo__details">
            <section>
              <h2>{__('Peers')}</h2>
              <div className="livestream-demo__peer-list">
                {peers.length ? (
                  peers.map((peer) => (
                    <div key={peerKey(peer)} className="livestream-demo__peer">
                      <strong>{compactId(peerKey(peer))}</strong>
                      <span>{peerRole(peer)}</span>
                      <em>{peerExpiry(peer)}</em>
                    </div>
                  ))
                ) : (
                  <div className="livestream-demo__empty">{__('Waiting for peer announcements')}</div>
                )}
              </div>
            </section>

            <EndpointList
              title={__('Signaling')}
              values={signalingUrl ? [`${signalingUrl}/signal`, `${signalingUrl}/signals`] : []}
              empty={__('HyperBEAM not configured')}
            />
          </div>

          <div className="livestream-demo__details livestream-demo__details--compact">
            <EndpointList title={__('Tracker')} values={[__('HyperBEAM room signaling')]} />
            <EndpointList
              title={__('ICE')}
              values={iceServers.map((server) => String(server.urls))}
              empty={__('Browser host candidates')}
            />
          </div>
        </section>
      </main>
    </Page>
  );
}

function MediaPanel({
  title,
  videoRef,
  muted,
  active,
}: {
  title: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
  active: boolean;
}) {
  return (
    <section className="livestream-demo__media">
      <div className="livestream-demo__panel-head">
        <h2>{title}</h2>
        <span className={active ? 'livestream-demo__pill is-online' : 'livestream-demo__pill'}>
          {active ? __('live') : __('idle')}
        </span>
      </div>
      <video ref={videoRef} autoPlay playsInline muted={muted} />
    </section>
  );
}

function PeerPanel({
  title,
  config,
  testId,
}: {
  title: string;
  config: LivestreamP2PCoordination;
  testId: string;
}) {
  const active = config.source === 'hyperbeam';
  return (
    <section className="livestream-demo__panel" data-testid={testId} data-peer-id={config.peerId}>
      <div className="livestream-demo__panel-head">
        <h2>{title}</h2>
        <span className={active ? 'livestream-demo__pill is-online' : 'livestream-demo__pill'}>
          {active ? __('announced') : __('fallback')}
        </span>
      </div>
      <dl>
        <div>
          <dt>{__('Peer ID')}</dt>
          <dd>{compactId(config.peerId)}</dd>
        </div>
        <div>
          <dt>{__('Heartbeat')}</dt>
          <dd>{Math.round(config.heartbeatMs / 1000)}s</dd>
        </div>
        <div>
          <dt>{__('Known peers')}</dt>
          <dd>{config.peers.length}</dd>
        </div>
      </dl>
    </section>
  );
}

function EndpointList({ title, values, empty }: { title: string; values: string[]; empty?: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <ul className="livestream-demo__endpoint-list">
        {values.length ? (
          values.map((value) => <li key={value}>{value}</li>)
        ) : (
          <li>{empty || __('None')}</li>
        )}
      </ul>
    </section>
  );
}

export default LivestreamP2PDemoPage;
