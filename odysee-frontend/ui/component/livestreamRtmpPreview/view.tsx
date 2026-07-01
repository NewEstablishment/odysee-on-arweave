import React from 'react';
import Hls from 'hls.js';
import './style.scss';

type PreviewStatus = 'idle' | 'loading' | 'playing' | 'unsupported' | 'error';

type Props = {
  active: boolean;
  videoUrl?: string | null;
};

export default function LivestreamRtmpPreview({ active, videoUrl }: Props) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const hlsRef = React.useRef<Hls | null>(null);
  const [status, setStatus] = React.useState<PreviewStatus>('idle');

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.removeAttribute('src');
    video.load();

    if (!active || !videoUrl) {
      setStatus('idle');
      return;
    }

    let closed = false;
    setStatus('loading');
    video.muted = true;
    video.crossOrigin = 'anonymous';

    const handlePlaying = () => {
      if (!closed) setStatus('playing');
    };
    const handleWaiting = () => {
      if (!closed) setStatus('loading');
    };
    const handleError = () => {
      if (!closed) setStatus('error');
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleError);

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 20,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(videoUrl));
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data?.fatal && !closed) setStatus('error');
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
    } else {
      setStatus('unsupported');
    }

    void video.play().catch(() => {});

    return () => {
      closed = true;
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [active, videoUrl]);

  const showStatus = status !== 'playing';
  const label =
    status === 'loading'
      ? __('Loading RTMP preview')
      : status === 'unsupported'
        ? __('RTMP preview unsupported')
        : status === 'error'
          ? __('RTMP preview unavailable')
          : __('Waiting for RTMP preview');

  return (
    <div className="livestream-rtmp-preview">
      <video ref={videoRef} className="livestream-rtmp-preview__video" muted playsInline controls />
      {showStatus && <div className="livestream-rtmp-preview__status">{label}</div>}
    </div>
  );
}
