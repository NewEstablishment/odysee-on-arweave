import React from 'react';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { icons as customIcons } from 'component/common/icon-custom';
import classnames from 'classnames';
import { platform } from 'util/platform';
import { LIVESTREAM_SOURCE_SELECTOR_CLASSES as C } from './classes';

const OdyseePlay = customIcons[ICONS.PLAY];
const OdyseeRepeat = customIcons[ICONS.REPEAT];

function TruncatedLabel({ label }: { label: string }) {
  const match = label.match(/^(.*?)(\s*\(\d+\))$/);
  const base = match ? match[1] : label;
  const suffix = match ? match[2] : '';
  return (
    <span className={C.itemLabel} title={label}>
      <span className={C.itemLabelBase}>{base}</span>
      {suffix && <span className={C.itemLabelSuffix}>{suffix}</span>}
    </span>
  );
}

export type VideoSource = {
  deviceId: string;
  label: string;
  kind: 'camera' | 'screen' | 'image' | 'videofile';
};

export type AudioSource = {
  deviceId: string;
  label: string;
  groupId?: string;
  kind?: 'mic' | 'audiofile';
};

type Props = {
  activeVideoIds: Set<string>;
  activeAudioIds: Set<string>;
  activeVideoOrder?: string[];
  activeImageSources?: VideoSource[];
  onToggleVideo: (source: VideoSource) => void;
  onToggleAudio: (source: AudioSource) => void;
  onReorderVideo?: (fromId: string, toId: string) => void;
  audioVolumes?: Record<string, number>;
  masterVolume?: number;
  onAudioVolumeChange?: (id: string, volume: number) => void;
  onMasterVolumeChange?: (volume: number) => void;
  getAudioLevel?: (id: string) => number;
  getMasterAudioLevel?: () => number;
  extraAudioSources?: AudioSource[];
  getAudioElement?: (id: string) => HTMLMediaElement | null;
  getVideoElement?: (id: string) => HTMLMediaElement | null;
  getLayerVisible?: (id: string) => boolean;
  onToggleLayerVisible?: (id: string) => void;
  onSelectLayer?: (id: string) => void;
  mutedAudios?: Set<string>;
  onToggleAudioMute?: (id: string) => void;
  needsCameraPermission?: boolean;
  cameraPermissionRequesting?: boolean;
  onRequestCameraPermission?: () => void;
  activeWidgetIds?: Set<string>;
  onToggleWidget?: (id: string) => void;
  disabled?: boolean;
};

export default function LivestreamSourceSelector(props: Props) {
  const {
    activeVideoIds,
    activeAudioIds,
    activeVideoOrder,
    activeImageSources,
    onToggleVideo,
    onToggleAudio,
    onReorderVideo,
    audioVolumes,
    masterVolume,
    onAudioVolumeChange,
    onMasterVolumeChange,
    getAudioLevel,
    getMasterAudioLevel,
    extraAudioSources,
    getAudioElement,
    getVideoElement,
    getLayerVisible,
    onToggleLayerVisible,
    onSelectLayer,
    mutedAudios,
    onToggleAudioMute,
    needsCameraPermission,
    cameraPermissionRequesting,
    onRequestCameraPermission,
    activeWidgetIds,
    onToggleWidget,
    disabled,
  } = props;
  const dragSourceRef = React.useRef<string | null>(null);
  const [videoSources, setVideoSources] = React.useState<VideoSource[]>([]);
  const [audioSources, setAudioSources] = React.useState<AudioSource[]>([]);
  const screenSupported =
    !platform.isMobile() &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  React.useEffect(() => {
    enumerateDevices();

    const onVisibilityChange = () => {
      if (!document.hidden) enumerateDevices();
    };
    navigator.mediaDevices?.addEventListener('devicechange', enumerateDevices);
    window.addEventListener('focus', enumerateDevices);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', enumerateDevices);
      window.removeEventListener('focus', enumerateDevices);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  React.useEffect(() => {
    if (!needsCameraPermission) enumerateDevices();
  }, [needsCameraPermission]);

  function enumerateDevices() {
    navigator.mediaDevices?.enumerateDevices().then((devices) => {
      const aliasIds = new Set(['default', 'communications']);
      const dedupeByGroup = (list: MediaDeviceInfo[]) => {
        const seen = new Set<string>();
        const result: MediaDeviceInfo[] = [];
        const sorted = [...list].sort((a, b) => {
          const aIsAlias = aliasIds.has(a.deviceId) ? 1 : 0;
          const bIsAlias = aliasIds.has(b.deviceId) ? 1 : 0;
          return aIsAlias - bIsAlias;
        });
        for (const d of sorted) {
          const key = d.groupId || d.deviceId;
          if (!key) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(d);
        }
        return result;
      };
      const videoInputs = dedupeByGroup(devices.filter((d) => d.kind === 'videoinput'));
      const audioInputs = dedupeByGroup(devices.filter((d) => d.kind === 'audioinput'));

      const cleanLabel = (raw: string) => raw.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/gi, '').trim();

      const cameraLabel = (d: MediaDeviceInfo, i: number) =>
        cleanLabel(d.label || __('Camera %number%', { number: i + 1 }));

      const cameras: VideoSource[] = videoInputs.map((d, i) => ({
        deviceId: d.deviceId,
        label: cameraLabel(d, i),
        kind: 'camera' as const,
      }));

      if (screenSupported) {
        cameras.push({
          deviceId: '__screen__',
          label: __('Screen Share'),
          kind: 'screen',
        });
      }

      cameras.push({
        deviceId: '__image__',
        label: __('Image'),
        kind: 'image',
      });

      cameras.push({
        deviceId: '__videofile__',
        label: __('Video'),
        kind: 'videofile',
      });

      const mics: AudioSource[] = [];
      const usedAudioDeviceIds = new Set<string>();
      const pairedGroupIds = new Set<string>();

      const audioOutputGroupIds = new Set(
        devices
          .filter((d) => d.kind === 'audiooutput' && !aliasIds.has(d.deviceId))
          .map((d) => d.groupId)
          .filter(Boolean)
      );
      const realAudioInputs = audioInputs.filter(
        (a) =>
          !aliasIds.has(a.deviceId) &&
          !/^monitor of |loopback/i.test(a.label || '') &&
          !(a.groupId && audioOutputGroupIds.has(a.groupId))
      );

      videoInputs.forEach((cam, i) => {
        const groupId = cam.groupId;
        if (!groupId) return;
        const match = realAudioInputs.find((a) => a.groupId === groupId);
        if (!match) return;
        const camLabel = cameraLabel(cam, i);
        mics.push({
          deviceId: match.deviceId,
          label: cleanLabel(match.label) || `${camLabel} – ${__('Microphone')}`,
          groupId,
        });
        if (match.deviceId) usedAudioDeviceIds.add(match.deviceId);
        pairedGroupIds.add(groupId);
      });

      realAudioInputs
        .filter((a) => !usedAudioDeviceIds.has(a.deviceId) && (!a.groupId || !pairedGroupIds.has(a.groupId)))
        .forEach((d, i) => {
          mics.push({
            deviceId: d.deviceId,
            label: cleanLabel(d.label) || __('Microphone %number%', { number: i + 1 }),
            groupId: d.groupId || undefined,
          });
        });

      mics.push({
        deviceId: '__audiofile__',
        label: __('Audio'),
        kind: 'audiofile',
      });

      setVideoSources(cameras);
      setAudioSources(mics);
    });
  }

  const allVideoSources = [...videoSources, ...(activeImageSources || [])];

  const activeVideoSources = (() => {
    const active = allVideoSources.filter((s) => activeVideoIds.has(s.deviceId));
    if (activeVideoOrder) {
      return active.sort((a, b) => {
        const ai = activeVideoOrder.indexOf(a.deviceId);
        const bi = activeVideoOrder.indexOf(b.deviceId);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
    }
    return active;
  })();
  const inactiveVideoSources = videoSources.filter((s) => !activeVideoIds.has(s.deviceId));
  const allAudioSources = [...audioSources, ...(extraAudioSources || [])];
  const activeAudioSources = allAudioSources.filter((s) => activeAudioIds.has(s.deviceId));
  const inactiveAudioSources = audioSources.filter((s) => !activeAudioIds.has(s.deviceId));

  function renderVideoItem(source: VideoSource) {
    const isActive = activeVideoIds.has(source.deviceId);
    const videoEl = isActive && getVideoElement ? getVideoElement(source.deviceId) : null;
    if (videoEl) {
      return (
        <div key={source.deviceId} className={classnames(C.item, C.itemAudio, C.itemActive)}>
          <button className={C.itemToggle} onClick={() => onToggleVideo(source)} disabled={disabled}>
            <span className={classnames(C.checkbox, C.checkboxChecked)} />
            <TruncatedLabel label={source.label} />
          </button>
          <MediaPlayerControls element={videoEl} />
        </div>
      );
    }
    return (
      <button
        key={source.deviceId}
        className={classnames(C.item, {
          [C.itemActive]: isActive,
        })}
        onClick={() => onToggleVideo(source)}
        disabled={disabled}
      >
        {source.kind === 'image' || source.kind === 'videofile' ? (
          <span className={C.addIcon}>+</span>
        ) : (
          <span
            className={classnames(C.checkbox, {
              [C.checkboxChecked]: isActive,
            })}
          />
        )}
        {source.kind === 'screen' ? (
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
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        ) : source.kind === 'image' ? (
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
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ) : source.kind === 'videofile' ? (
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
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        ) : (
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
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        )}
        <TruncatedLabel label={source.label} />
      </button>
    );
  }

  function renderAudioItem(source: AudioSource) {
    const isActive = activeAudioIds.has(source.deviceId);
    const volume = audioVolumes?.[source.deviceId] ?? 1;
    const isPicker = source.kind === 'audiofile';
    return (
      <div
        key={source.deviceId}
        className={classnames(C.item, C.itemAudio, {
          [C.itemActive]: isActive,
        })}
      >
        <button className={C.itemToggle} onClick={() => onToggleAudio(source)} disabled={disabled}>
          {isPicker ? (
            <span className={C.addIcon}>+</span>
          ) : (
            <span
              className={classnames(C.checkbox, {
                [C.checkboxChecked]: isActive,
              })}
            />
          )}
          {isPicker && (
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
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          )}
          <TruncatedLabel label={source.label} />
          {isActive && onAudioVolumeChange && <span className={C.volumeValue}>{Math.round(volume * 100)}%</span>}
          {isActive && onToggleAudioMute && (
            <span
              className={C.muteButton}
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleAudioMute(source.deviceId);
              }}
              title={mutedAudios?.has(source.deviceId) ? __('Unmute') : __('Mute')}
            >
              {mutedAudios?.has(source.deviceId) ? (
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
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
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
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </span>
          )}
        </button>
        {isActive && getAudioElement && getAudioElement(source.deviceId) && (
          <MediaPlayerControls element={getAudioElement(source.deviceId)} />
        )}
        {isActive && onAudioVolumeChange && (
          <>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => onAudioVolumeChange(source.deviceId, parseFloat(e.target.value))}
              className={C.volumeSlider}
            />
            {getAudioLevel && <MeterBar getLevel={() => getAudioLevel(source.deviceId)} resetSignal={volume} />}
          </>
        )}
      </div>
    );
  }

  function renderMasterRow() {
    if (!onMasterVolumeChange || activeAudioIds.size < 2) return null;
    const v = masterVolume ?? 1;
    return (
      <div className={classnames(C.item, C.itemAudio, C.itemMaster)}>
        <div className={classnames(C.itemToggle, C.itemToggleStatic)}>
          <span className={C.itemLabel}>{__('Master')}</span>
          <span className={C.volumeValue}>{Math.round(v * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={v}
          onChange={(e) => onMasterVolumeChange(parseFloat(e.target.value))}
          className={C.volumeSlider}
        />
        {getMasterAudioLevel && <MeterBar getLevel={getMasterAudioLevel} resetSignal={v} />}
      </div>
    );
  }

  return (
    <div className={C.root}>
      {needsCameraPermission && onRequestCameraPermission && (
        <button
          type="button"
          className={C.permissionButton}
          onClick={onRequestCameraPermission}
          disabled={cameraPermissionRequesting}
        >
          {cameraPermissionRequesting ? __('Requesting...') : __('Allow Camera & Mic access')}
        </button>
      )}
      <div className={C.box}>
        <h3 className={C.title}>
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
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          {__('Video')}
        </h3>
        {activeVideoSources.length > 0 && (
          <div className={C.subbox}>
            <span className={C.subboxLabel}>{__('Active')}</span>
            <div className={C.list}>
              {activeVideoSources.map((source, idx) => (
                <div
                  key={source.deviceId}
                  className={C.activeRow}
                  draggable
                  onDragStart={() => {
                    dragSourceRef.current = source.deviceId;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragSourceRef.current && dragSourceRef.current !== source.deviceId && onReorderVideo) {
                      onReorderVideo(dragSourceRef.current, source.deviceId);
                    }
                    dragSourceRef.current = null;
                  }}
                >
                  <div
                    className={classnames(C.item, C.itemActive, C.activeRowItem)}
                    onClick={() => onSelectLayer?.(source.deviceId)}
                  >
                    {source.kind === 'image' ? (
                      <span
                        className={C.removeIcon}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleVideo(source);
                        }}
                      >
                        ×
                      </span>
                    ) : (
                      <span
                        className={classnames(C.checkbox, C.checkboxChecked)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleVideo(source);
                        }}
                      />
                    )}
                    {source.kind === 'screen' ? (
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
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    ) : source.kind === 'image' ? (
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
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    ) : (
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
                        <path d="M23 7l-7 5 7 5V7z" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                    <TruncatedLabel label={source.label} />
                  </div>
                  {onToggleLayerVisible && (
                    <button
                      type="button"
                      className={C.visibilityButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLayerVisible(source.deviceId);
                      }}
                      title={getLayerVisible?.(source.deviceId) === false ? __('Show') : __('Hide')}
                    >
                      {getLayerVisible?.(source.deviceId) === false ? (
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
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
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
                      )}
                    </button>
                  )}
                  <div className={C.reorderButtons}>
                    <button
                      className={C.reorderButton}
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (idx > 0 && onReorderVideo)
                          onReorderVideo(source.deviceId, activeVideoSources[idx - 1].deviceId);
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>
                    <button
                      className={C.reorderButton}
                      disabled={idx === activeVideoSources.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (idx < activeVideoSources.length - 1 && onReorderVideo)
                          onReorderVideo(source.deviceId, activeVideoSources[idx + 1].deviceId);
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className={C.subbox}>
          <span className={C.subboxLabel}>{__('Available')}</span>
          <div className={C.list}>
            {inactiveVideoSources.map(renderVideoItem)}
            {inactiveVideoSources.length === 0 && videoSources.length > 0 && (
              <span className={C.empty}>{__('All sources active')}</span>
            )}
            {videoSources.length === 0 && <span className={C.empty}>{__('No video sources found')}</span>}
          </div>
        </div>
      </div>

      <div className={C.box}>
        <h3 className={C.title}>
          <Icon icon={ICONS.AUDIO} size={14} />
          {__('Audio')}
        </h3>
        {activeAudioSources.length > 0 && (
          <div className={C.subbox}>
            <span className={C.subboxLabel}>{__('Active')}</span>
            <div className={C.list}>
              {renderMasterRow()}
              {activeAudioSources.map(renderAudioItem)}
            </div>
          </div>
        )}
        <div className={C.subbox}>
          <span className={C.subboxLabel}>{__('Available')}</span>
          <div className={C.list}>
            {inactiveAudioSources.map(renderAudioItem)}
            {inactiveAudioSources.length === 0 && audioSources.length > 0 && (
              <span className={C.empty}>{__('All sources active')}</span>
            )}
            {audioSources.length === 0 && <span className={C.empty}>{__('No audio sources found')}</span>}
          </div>
        </div>
      </div>

      <div className={C.box}>
        <h3 className={C.title}>
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
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          {__('Widgets')}
        </h3>
        <div className={C.subbox}>
          <div className={C.list}>
            <div className={C.activeRow}>
              <button
                type="button"
                className={classnames(C.item, C.activeRowItem, {
                  [C.itemActive]: activeWidgetIds?.has('__widget_chat__'),
                })}
                onClick={() => {
                  if (activeWidgetIds?.has('__widget_chat__')) {
                    onSelectLayer?.('__widget_chat__');
                  } else {
                    onToggleWidget?.('__widget_chat__');
                  }
                }}
                disabled={disabled || !onToggleWidget}
              >
                <span
                  className={classnames(C.checkbox, {
                    [C.checkboxChecked]: activeWidgetIds?.has('__widget_chat__'),
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWidget?.('__widget_chat__');
                  }}
                />
                <Icon icon={ICONS.CHAT} size={14} />
                <TruncatedLabel label={__('Chat')} />
              </button>
              {activeWidgetIds?.has('__widget_chat__') && onToggleLayerVisible && (
                <button
                  type="button"
                  className={C.visibilityButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLayerVisible('__widget_chat__');
                  }}
                  title={getLayerVisible?.('__widget_chat__') === false ? __('Show') : __('Hide')}
                >
                  {getLayerVisible?.('__widget_chat__') === false ? (
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
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
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
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeterBar({ getLevel, resetSignal }: { getLevel: () => number; resetSignal?: unknown }) {
  const fillRef = React.useRef<HTMLDivElement | null>(null);
  const peakRef = React.useRef<HTMLDivElement | null>(null);
  const peakRefValue = React.useRef(0);

  React.useEffect(() => {
    peakRefValue.current = 0;
    if (peakRef.current) peakRef.current.style.left = '0%';
  }, [resetSignal]);

  React.useEffect(() => {
    let raf = 0;
    let peakHoldUntil = 0;
    const PEAK_HOLD_MS = 2500;
    const PEAK_DECAY_PER_SEC = 0.08;
    let lastTs = performance.now();
    const tick = (ts: number) => {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      const rms = getLevel();
      const level = Math.max(0, Math.min(1, rms * 3));
      if (level > peakRefValue.current) {
        peakRefValue.current = level;
        peakHoldUntil = ts + PEAK_HOLD_MS;
      } else if (ts > peakHoldUntil) {
        peakRefValue.current = Math.max(level, peakRefValue.current - PEAK_DECAY_PER_SEC * dt);
      }
      if (peakRef.current) {
        const p = peakRefValue.current;
        peakRef.current.style.left = `${p * 100}%`;
        peakRef.current.style.backgroundColor = p >= 0.85 ? '#e74c3c' : p >= 0.7 ? '#f0c33c' : '#2dd06e';
      }
      if (fillRef.current) fillRef.current.style.clipPath = `inset(0 ${(1 - level) * 100}% 0 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);

  return (
    <div className={C.meter}>
      <div className={C.meterFill} ref={fillRef} />
      <div className={C.meterPeak} ref={peakRef} />
    </div>
  );
}

function MediaPlayerControls({ element }: { element: HTMLMediaElement }) {
  const [paused, setPaused] = React.useState(element.paused);
  const [loop, setLoop] = React.useState(element.loop);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(element.duration || 0);

  React.useEffect(() => {
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onLoaded = () => setDuration(element.duration || 0);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('loadedmetadata', onLoaded);
    return () => {
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [element]);

  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      setProgress(element.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [element]);

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${ss}`;
  };

  return (
    <div className={C.player}>
      <div className={C.playerRow}>
        <div className={C.playerButtons}>
          <button
            type="button"
            className={C.playerButton}
            onClick={() => (element.paused ? element.play() : element.pause())}
            title={paused ? __('Play') : __('Pause')}
          >
            {paused ? (
              <OdyseePlay size={12} color="currentColor" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className={C.playerButton}
            onClick={() => {
              element.pause();
              element.currentTime = 0;
            }}
            title={__('Stop')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className={classnames(C.playerButton, {
              [C.playerButtonActive]: loop,
            })}
            onClick={() => {
              element.loop = !element.loop;
              setLoop(element.loop);
            }}
            title={__('Loop')}
          >
            <OdyseeRepeat size={12} color="currentColor" />
          </button>
        </div>
        <span className={C.playerTime}>
          {formatTime(progress)} / {formatTime(duration)}
        </span>
      </div>
      <PlayerProgress
        progress={progress}
        duration={duration}
        onSeek={(v) => {
          element.currentTime = v;
        }}
      />
    </div>
  );
}

function PlayerProgress({
  progress,
  duration,
  onSeek,
}: {
  progress: number;
  duration: number;
  onSeek: (value: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);

  const setFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || !duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setFromClientX(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const fillPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div
      className={C.seek}
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={C.seekTrack}>
        <div className={C.seekFill} style={{ width: `${fillPct}%` }} />
      </div>
      <div className={C.seekThumb} style={{ left: `${fillPct}%` }} />
    </div>
  );
}
