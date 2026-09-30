import React from 'react';
import classnames from 'classnames';
import {
  type StreamMetrics,
  formatBps,
  formatResolution,
  formatCodec,
  formatVideoBitrate,
  formatAudioBitrate,
  formatSourceType,
} from 'util/livestreamMetrics';
import { LIVESTREAM_METRICS_CLASSES as C } from './classes';

type Mode = 'compact' | 'overlay' | 'full' | 'card';

type Props = {
  metrics: StreamMetrics | null;
  mode: Mode;
  className?: string;
};

// --- Compact mode (slim inline bar under video / in floating dock) ---
function CompactMetrics({ metrics }: { metrics: StreamMetrics }) {
  if (!metrics.live) return null;

  const tp = metrics.throughput;

  return (
    <div className={`${C.base} ${C.compact}`}>
      {/* Source type */}
      {metrics.source_type && <span className={C.chip}>{formatSourceType(metrics.source_type)}</span>}
      {/* Video info */}
      {metrics.video && (
        <span className={C.chip}>
          {formatResolution(metrics.video)} {formatCodec(metrics.video.codec)}
        </span>
      )}
      {/* Ingest bitrate */}
      {tp && tp.in_bps > 0 && (
        <span className={C.chip} title={`avg ${formatBps(tp.avg_in_bps)}`}>
          {/* Arrow up icon */}
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
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
          {formatBps(tp.in_bps)}
        </span>
      )}
      {/* Health dot */}
      <span
        className={classnames(C.healthDot, {
          [C.healthGood]: tp && tp.in_bps > 0,
          [C.healthUnknown]: !tp || tp.in_bps <= 0,
        })}
      />
    </div>
  );
}

// --- Overlay mode (WebRTC publisher preview) ---
// Shows: viewer badge, source type badge
function OverlayMetrics({ metrics }: { metrics: StreamMetrics }) {
  if (!metrics.live) return null;

  const viewers = metrics.viewers?.total ?? 0;

  return (
    <div className={`${C.base} ${C.overlay}`}>
      <span className={C.viewersBadge}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>{viewers}</span>
      </span>
      {metrics.source_type && <span className={C.sourceBadge}>{formatSourceType(metrics.source_type)}</span>}
    </div>
  );
}

// --- Full mode (creator's own claim page) ---
// Shows: viewer breakdown, throughput, codec info, resolution
function FullMetrics({ metrics }: { metrics: StreamMetrics }) {
  if (!metrics.live) {
    return (
      <div className={`${C.base} ${C.full} ${C.fullOffline}`}>
        <span className={C.offlineLabel}>{__('Stream offline')}</span>
      </div>
    );
  }

  const viewers = metrics.viewers;
  const tp = metrics.throughput;

  return (
    <div className={`${C.base} ${C.full}`}>
      {/* Top row: viewers + source */}
      <div className={C.fullHeader}>
        <div className={C.fullViewers}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className={C.fullViewerCount}>{viewers?.total ?? 0}</span>
          <span className={C.fullViewerLabel}>{__('viewers')}</span>
        </div>
        {metrics.source_type && <span className={C.fullSource}>{formatSourceType(metrics.source_type)}</span>}
      </div>

      {/* Grid of stats */}
      <div className={C.fullGrid}>
        {viewers && (viewers.llhls > 0 || viewers.webrtc > 0) && (
          <div className={C.fullStat}>
            <span className={C.fullStatLabel}>{__('Viewer breakdown')}</span>
            <span className={C.fullStatValue}>
              {viewers.llhls} LLHLS / {viewers.webrtc} WebRTC
            </span>
          </div>
        )}

        {metrics.video && (
          <div className={C.fullStat}>
            <span className={C.fullStatLabel}>{__('Video')}</span>
            <span className={C.fullStatValue}>
              {formatCodec(metrics.video.codec)} {formatResolution(metrics.video)} @ {metrics.video.framerate}fps
            </span>
          </div>
        )}

        {metrics.video && (
          <div className={C.fullStat}>
            <span className={C.fullStatLabel}>{__('Video bitrate')}</span>
            <span className={C.fullStatValue}>{formatVideoBitrate(metrics.video)}</span>
          </div>
        )}

        {metrics.audio && (
          <div className={C.fullStat}>
            <span className={C.fullStatLabel}>{__('Audio')}</span>
            <span className={C.fullStatValue}>
              {formatCodec(metrics.audio.codec)} {formatAudioBitrate(metrics.audio)}
            </span>
          </div>
        )}

        {tp && (
          <div className={C.fullStat}>
            <span className={C.fullStatLabel}>{__('Throughput in')}</span>
            <span className={C.fullStatValue}>
              {formatBps(tp.in_bps)}
              <span className={C.fullStatSub}>avg {formatBps(tp.avg_in_bps)}</span>
            </span>
          </div>
        )}

        {tp && (
          <div className={C.fullStat}>
            <span className={C.fullStatLabel}>{__('Throughput out')}</span>
            <span className={C.fullStatValue}>
              {formatBps(tp.out_bps)}
              <span className={C.fullStatSub}>avg {formatBps(tp.avg_out_bps)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Card mode (RTMP setup page) ---
// Clean card with stream health info
function CardMetrics({ metrics }: { metrics: StreamMetrics }) {
  if (!metrics.live) {
    return (
      <div className={`${C.base} ${C.card} ${C.cardOffline}`}>
        <div className={C.cardHeader}>
          <span className={`${C.cardDot} ${C.cardDotOffline}`} />
          <span className={C.cardTitle}>{__('Stream Health')}</span>
        </div>
        <p className={C.cardOfflineText}>{__('Not currently streaming via RTMP.')}</p>
      </div>
    );
  }

  const viewers = metrics.viewers;
  const tp = metrics.throughput;

  return (
    <div className={`${C.base} ${C.card}`}>
      <div className={C.cardHeader}>
        <span className={`${C.cardDot} ${C.cardDotLive}`} />
        <span className={C.cardTitle}>{__('Stream Health')}</span>
        {metrics.source_type && <span className={C.cardSource}>{formatSourceType(metrics.source_type)}</span>}
        <span className={C.cardViewers}>
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
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {viewers?.total ?? 0}
        </span>
      </div>

      <div className={C.cardGrid}>
        {metrics.video && (
          <div className={C.cardStat}>
            <span className={C.cardStatLabel}>{__('Video')}</span>
            <span className={C.cardStatValue}>
              {formatCodec(metrics.video.codec)} {formatResolution(metrics.video)}
            </span>
          </div>
        )}

        {metrics.video && (
          <div className={C.cardStat}>
            <span className={C.cardStatLabel}>{__('Bitrate')}</span>
            <span className={C.cardStatValue}>{formatVideoBitrate(metrics.video)}</span>
          </div>
        )}

        {metrics.video && (
          <div className={C.cardStat}>
            <span className={C.cardStatLabel}>{__('FPS')}</span>
            <span className={C.cardStatValue}>{metrics.video.framerate}</span>
          </div>
        )}

        {metrics.audio && (
          <div className={C.cardStat}>
            <span className={C.cardStatLabel}>{__('Audio')}</span>
            <span className={C.cardStatValue}>
              {formatCodec(metrics.audio.codec)} {formatAudioBitrate(metrics.audio)}
            </span>
          </div>
        )}

        {tp && (
          <div className={C.cardStat}>
            <span className={C.cardStatLabel}>{__('In')}</span>
            <span className={C.cardStatValue}>{formatBps(tp.in_bps)}</span>
          </div>
        )}

        {tp && (
          <div className={C.cardStat}>
            <span className={C.cardStatLabel}>{__('Out')}</span>
            <span className={C.cardStatValue}>{formatBps(tp.out_bps)}</span>
          </div>
        )}

        {viewers && (viewers.llhls > 0 || viewers.webrtc > 0) && (
          <div className={`${C.cardStat} ${C.cardStatWide}`}>
            <span className={C.cardStatLabel}>{__('Viewers')}</span>
            <span className={C.cardStatValue}>
              {viewers.llhls} LLHLS / {viewers.webrtc} WebRTC
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main component ---

export default function LivestreamMetrics(props: Props) {
  const { metrics, mode, className } = props;

  if (!metrics) return null;

  const wrapClass = className || undefined;

  switch (mode) {
    case 'compact':
      return (
        <div className={wrapClass}>
          <CompactMetrics metrics={metrics} />
        </div>
      );
    case 'overlay':
      return (
        <div className={wrapClass}>
          <OverlayMetrics metrics={metrics} />
        </div>
      );
    case 'full':
      return (
        <div className={wrapClass}>
          <FullMetrics metrics={metrics} />
        </div>
      );
    case 'card':
      return (
        <div className={wrapClass}>
          <CardMetrics metrics={metrics} />
        </div>
      );
    default:
      return null;
  }
}
