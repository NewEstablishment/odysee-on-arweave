import React from 'react';
import Hls from 'hls.js';
import Button from 'component/button';
import * as ICONS from 'constants/icons';
import {
  getLivestreamReplayFile,
  saveLivestreamReplay,
  type LivestreamReplayEntry,
} from 'util/livestreamReplayStorage';
import './style.scss';

type RecorderStatus = 'idle' | 'loading' | 'recording' | 'saving' | 'saved' | 'unsupported' | 'error';

const RECORDING_CHUNK_INTERVAL_MS = 1000;

type Props = {
  active: boolean;
  videoUrl?: string | null;
  channelId?: string | null;
  claimId?: string | null;
  uri?: string | null;
  title?: string | null;
  publishingReplay?: boolean;
  onReplaySaved?: (entry: LivestreamReplayEntry) => void;
  onPublishReplay?: (entry: LivestreamReplayEntry) => void;
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function captureVideoStream(video: HTMLVideoElement): MediaStream | null {
  const capture = (video as any).captureStream || (video as any).mozCaptureStream;
  if (typeof capture !== 'function') return null;
  return capture.call(video);
}

function canCaptureVideoStream(video: HTMLVideoElement): boolean {
  return typeof ((video as any).captureStream || (video as any).mozCaptureStream) === 'function';
}

export default function LivestreamRtmpReplayRecorder({
  active,
  videoUrl,
  channelId,
  claimId,
  uri,
  title,
  publishingReplay,
  onReplaySaved,
  onPublishReplay,
}: Props) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const hlsRef = React.useRef<Hls | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const capturedStreamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const onReplaySavedRef = React.useRef(onReplaySaved);
  const onPublishReplayRef = React.useRef(onPublishReplay);
  const [status, setStatus] = React.useState<RecorderStatus>('idle');
  const [bytes, setBytes] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [savedReplay, setSavedReplay] = React.useState<LivestreamReplayEntry | null>(null);
  const [savedReplayPreviewUrl, setSavedReplayPreviewUrl] = React.useState<string | null>(null);
  const [downloadingReplay, setDownloadingReplay] = React.useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    onReplaySavedRef.current = onReplaySaved;
    onPublishReplayRef.current = onPublishReplay;
  }, [onReplaySaved, onPublishReplay]);

  React.useEffect(() => {
    if (status !== 'loading' && status !== 'recording' && status !== 'saving') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSavedReplayPreviewUrl(null);
    if (!savedReplay) return;
    getLivestreamReplayFile(savedReplay.id)
      .then((file) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSavedReplayPreviewUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [savedReplay?.id]);

  React.useEffect(() => {
    if (!active || !videoUrl) {
      if (!recorderRef.current) {
        setStatus((current) => (current === 'loading' || current === 'recording' ? 'idle' : current));
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (typeof MediaRecorder === 'undefined' || !getRecorderMimeType() || !canCaptureVideoStream(video)) {
      setStatus('unsupported');
      return;
    }

    let closed = false;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const mimeType = getRecorderMimeType();
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    chunksRef.current = chunks;
    setBytes(0);
    setSavedReplay(null);
    setError(null);
    setStatus('loading');

    const saveReplay = async () => {
      if (!chunks.length) {
        setStatus('error');
        setError(__('No replay data was captured. Keep preview open for a few seconds before ending the stream.'));
        return;
      }

      const endedAt = Date.now();
      const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType });
      setStatus('saving');
      setBytes(blob.size);
      try {
        const entry = await saveLivestreamReplay({
          blob,
          sourceType: 'rtmp',
          channelId,
          claimId,
          uri,
          title,
          startedAt,
          endedAt,
          name: title ? `${title.replace(/[^\w.-]+/g, '-')}-rtmp-replay.webm` : undefined,
        });
        if (!mountedRef.current) return;
        setSavedReplay(entry);
        onReplaySavedRef.current?.(entry);
        setStatus('saved');
        setBytes(entry.size);
      } catch (e: any) {
        if (!mountedRef.current) return;
        setStatus('error');
        setError(e?.message || __('Could not save RTMP replay in browser storage.'));
      }
    };

    const startRecorder = () => {
      if (closed || recorderRef.current) return;
      const stream = captureVideoStream(video);
      if (!stream || stream.getTracks().length === 0) {
        setStatus('error');
        setError(__('This browser could not capture the RTMP preview for local replay.'));
        return;
      }

      try {
        capturedStreamRef.current = stream;
        recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;
        recorder.addEventListener('dataavailable', (event) => {
          if (!event.data || event.data.size === 0) return;
          chunks.push(event.data);
          setBytes(chunks.reduce((total, chunk) => total + chunk.size, 0));
        });
        recorder.addEventListener('stop', () => {
          recorderRef.current = null;
          void saveReplay();
        });
        recorder.start(RECORDING_CHUNK_INTERVAL_MS);
        setStatus('recording');
      } catch (e: any) {
        capturedStreamRef.current?.getTracks().forEach((track) => track.stop());
        capturedStreamRef.current = null;
        recorderRef.current = null;
        setStatus('error');
        setError(e?.message || __('Could not start the local RTMP replay recorder.'));
      }
    };

    const handleCanPlay = () => {
      video.play().catch(() => {});
      startRecorder();
    };

    video.muted = true;
    video.volume = 0;
    video.crossOrigin = 'anonymous';
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('playing', handleCanPlay);

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
        if (data?.fatal) {
          setStatus('error');
          setError(data?.details || __('Could not load RTMP playback for local replay.'));
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
    } else {
      setStatus('unsupported');
    }

    return () => {
      closed = true;
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('playing', handleCanPlay);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      const activeRecorder = recorderRef.current;
      if (activeRecorder && activeRecorder.state !== 'inactive') {
        try {
          activeRecorder.requestData();
        } catch {}
        try {
          activeRecorder.stop();
        } catch {}
      }
      capturedStreamRef.current?.getTracks().forEach((track) => track.stop());
      capturedStreamRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [active, channelId, claimId, title, uri, videoUrl]);

  const detail =
    status === 'recording'
      ? __('Recording %size%', { size: formatBytes(bytes) })
      : status === 'loading'
        ? __('Starting recorder')
        : status === 'saving'
          ? __('Saving replay')
          : status === 'saved'
            ? __('Saved %size%', { size: formatBytes(bytes) })
            : status === 'unsupported'
              ? __('Unsupported browser')
              : status === 'error'
                ? error || __('Recorder failed')
                : active
                  ? __('Ready')
                  : __('Waiting for RTMP');

  async function downloadReplay() {
    if (!savedReplay || downloadingReplay) return;
    setDownloadingReplay(true);
    let objectUrl: string | null = null;
    try {
      const file = await getLivestreamReplayFile(savedReplay.id);
      if (!file) return;
      objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.name || savedReplay.name || 'livestream-rtmp-replay.webm';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloadingReplay(false);
    }
  }

  return (
    <div className="livestream-rtmp-recorder">
      <video ref={videoRef} className="livestream-rtmp-recorder__video" playsInline muted />
      {savedReplayPreviewUrl && (
        <video
          className="livestream-rtmp-recorder__saved-preview"
          src={savedReplayPreviewUrl}
          controls
          preload="metadata"
        />
      )}
      <div className="livestream-rtmp-recorder__content">
        <div>
          <span className="livestream-rtmp-recorder__label">{__('Local RTMP replay')}</span>
          <strong>{detail}</strong>
        </div>
        {savedReplay && (
          <div className="livestream-rtmp-recorder__saved-actions">
            <Button
              button="alt"
              icon={ICONS.DOWNLOAD}
              label={downloadingReplay ? __('Downloading...') : __('Download')}
              onClick={downloadReplay}
              disabled={publishingReplay || downloadingReplay}
            />
            <Button
              button="secondary"
              icon={ICONS.PUBLISH}
              label={publishingReplay ? __('Publishing...') : __('Publish replay')}
              onClick={() => onPublishReplayRef.current?.(savedReplay)}
              disabled={publishingReplay || downloadingReplay}
            />
          </div>
        )}
      </div>
    </div>
  );
}
