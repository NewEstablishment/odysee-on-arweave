import React from 'react';
import * as SETTINGS from 'constants/settings';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClientSetting } from 'redux/selectors/settings';
import { doSetClientSetting } from 'redux/actions/settings';
import { selectPrefsReady } from 'redux/selectors/sync';
import { getLivestreamWebrtcPlaybackUrl } from 'constants/livestream';
import { startWebrtcViewer, stopWebrtcViewer, type WebrtcViewerResult } from 'util/livestreamWebrtcViewer';

type Props = {
  channelClaimId: string;
  isCurrentClaimLive: boolean;
  /** Called when user exits WebRTC mode to go back to HLS */
  onExit: () => void;
};

type ViewerStatus = 'idle' | 'connecting' | 'playing' | 'error';

export default function LivestreamWebrtcViewer({ channelClaimId, isCurrentClaimLive, onExit }: Props) {
  const dispatch = useAppDispatch();
  const prefsReady = useAppSelector(selectPrefsReady);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const viewerRef = React.useRef<WebrtcViewerResult | null>(null);
  const [viewerStatus, setViewerStatus] = React.useState<ViewerStatus>('idle');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const signalingUrl = getLivestreamWebrtcPlaybackUrl(channelClaimId);
  const canConnect = Boolean(signalingUrl && isCurrentClaimLive);

  // Connect immediately on mount
  React.useEffect(() => {
    if (!canConnect || !signalingUrl) return;

    let canceled = false;
    const ac = new AbortController();
    setViewerStatus('connecting');
    setErrorMsg(null);

    startWebrtcViewer(signalingUrl, ac.signal)
      .then((result) => {
        if (canceled) {
          stopWebrtcViewer(result);
          return;
        }
        viewerRef.current = result;
        setViewerStatus('playing');
        const el = videoRef.current;
        if (el) {
          el.srcObject = result.stream;
          el.play().catch(() => {});
        }
      })
      .catch((e) => {
        if (canceled) return;
        setViewerStatus('error');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      });

    return () => {
      canceled = true;
      ac.abort();
      stopWebrtcViewer(viewerRef.current);
      viewerRef.current = null;
    };
  }, [canConnect, signalingUrl]);

  function handleExit() {
    stopWebrtcViewer(viewerRef.current);
    viewerRef.current = null;
    setViewerStatus('idle');
    onExit();
  }

  function handleDisableAndExit() {
    dispatch(doSetClientSetting(SETTINGS.P2P_DELIVERY, false, prefsReady));
    handleExit();
  }

  return (
    <div className="webrtc-viewer-surface tw:group/webrtc tw:relative tw:aspect-video tw:w-full tw:overflow-hidden tw:bg-black">
      <video ref={videoRef} className="tw:block tw:size-full tw:bg-black tw:object-contain" playsInline autoPlay />

      {viewerStatus === 'connecting' && (
        <div className="tw:absolute tw:inset-0 tw:z-[2] tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-s tw:bg-[rgba(0,0,0,0.75)]">
          <div className="tw:size-[24px] tw:rounded-[50%] tw:border-2 tw:border-[rgba(255,255,255,0.15)] tw:border-t-app-primary tw:[animation:webrtc-viewer-spin_0.7s_linear_infinite]" />
          <span className="tw:m-0 tw:text-app-small tw:font-semibold tw:text-[rgba(255,255,255,0.7)]">
            {__('Connecting P2P...')}
          </span>
        </div>
      )}

      {viewerStatus === 'error' && (
        <div className="tw:absolute tw:inset-0 tw:z-[2] tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-s tw:bg-[rgba(0,0,0,0.75)]">
          <p className="tw:m-0 tw:text-app-small tw:font-semibold tw:text-[rgba(255,255,255,0.7)]">
            {__('P2P connection failed')}
          </p>
          {errorMsg && (
            <p className="tw:m-0 tw:max-w-[20rem] tw:text-center tw:text-[11px] tw:text-[rgba(255,255,255,0.35)]">
              {errorMsg}
            </p>
          )}
          <button
            className="tw:mt-app-xs tw:cursor-pointer tw:rounded-[6px] tw:border tw:border-[rgba(255,255,255,0.2)] tw:bg-[rgba(255,255,255,0.08)] tw:px-[16px] tw:py-[6px] tw:text-app-small tw:font-semibold tw:text-[rgba(255,255,255,0.8)] tw:hover:bg-[rgba(255,255,255,0.15)] tw:hover:text-white"
            onClick={handleExit}
          >
            {__('Switch to standard player')}
          </button>
        </div>
      )}

      {/* Top-right controls: P2P badge + exit button */}
      {viewerStatus === 'playing' && (
        <div className="tw:pointer-events-none tw:absolute tw:top-app-xs tw:right-app-xs tw:z-[3] tw:flex tw:items-center tw:gap-[6px] tw:opacity-0 tw:transition-opacity tw:duration-200 tw:ease-[ease] tw:group-hover/webrtc:pointer-events-auto tw:group-hover/webrtc:opacity-100 tw:upto-small:pointer-events-auto tw:upto-small:opacity-100">
          <span className="tw:inline-flex tw:h-[24px] tw:items-center tw:gap-[4px] tw:rounded-[4px] tw:bg-[rgba(var(--color-primary-dynamic),0.3)] tw:px-[8px] tw:text-[11px] tw:font-bold tw:text-white tw:backdrop-blur-[8px]">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            {__('P2P')}
          </span>
          <button
            className="tw:flex tw:size-[28px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:[border:none] tw:bg-[rgba(0,0,0,0.6)] tw:text-white tw:backdrop-blur-[4px] tw:[transition:background_0.15s_ease] tw:hover:bg-[rgba(0,0,0,0.85)]"
            onClick={handleExit}
            title={__('Exit P2P mode')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
