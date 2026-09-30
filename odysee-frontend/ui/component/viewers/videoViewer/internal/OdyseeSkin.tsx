/* eslint-disable react/prop-types */
import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import Player from './player';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import SeekIndicator from './components/SeekIndicator';
import {
  BufferingIndicator,
  CaptionsButton,
  Controls,
  MuteButton,
  PlayButton,
  Popover,
  Slider,
  Time,
  TimeSlider,
  Tooltip,
  VolumeSlider,
} from '@videojs/react';
import { icons } from 'component/common/icon-custom';
import * as ICONS from 'constants/icons';
import * as QUALITY_OPTIONS from 'constants/player';
import { VIDEO_PLAYBACK_RATES } from 'constants/player';
import { platform } from 'util/platform';
import { useIsMobile } from 'effects/use-screensize';
import { isEmbedPath } from 'util/embed';
import usePersistedState from 'effects/use-persisted-state';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClientSetting } from 'redux/selectors/settings';
import { doSetClientSetting } from 'redux/actions/settings';
import * as SETTINGS from 'constants/settings';
import {
  fullscreenElement as getFullscreenElement,
  requestFullscreen,
  exitFullscreen,
  onFullscreenChange,
} from 'util/full-screen';
import parseChapters from 'util/parse-chapters';
import Logo from 'component/logo';
import { URL } from 'config';
import { formatLbryUrlForWeb, generateShareUrl } from 'util/url';

const CTX_SHARE_DOMAIN = 'https://odysee.com';
import { generateEmbedUrl, generateEmbedIframeData } from 'util/web';
import { doToast } from 'redux/actions/notifications';
import classnames from 'classnames';
import { CAST_CLASSES } from './cast-classes';
import { CHAPTER_CLASSES } from './chapter-classes';
import { CLICK_TO_PLAY_CLASS, CLICK_TO_PLAY_FLOATING_CLASS } from './components/interaction-overlay-classes';
import { CONTEXT_MENU_CLASSES } from './context-menu-classes';
import { EMBED_HEADER_CLASSES } from './embed-header-classes';
import { LIVE_BUTTON_CLASSES } from './live-button-classes';
import { P2P_CLASSES } from './p2p-classes';
import { PLAYER_BUTTON_CLASSES } from './player-button-classes';
import { VOLUME_CONTROL_CLASSES } from './volume-control-classes';
import { CONTROL_LAYOUT_CLASSES } from './control-layout-classes';
import { MOBILE_CONTROL_LAYOUT_CLASSES } from './mobile-control-layout-classes';
import { SLIDER_PREVIEW_CLASSES } from './slider-preview-classes';
import { PROGRESS_CONTROL_CLASSES } from './progress-control-classes';
import { MEDIA_SETTINGS_MENU_CLASSES } from './settings-menu-classes';
import { PLAYER_SKIN_CLASSES } from './skin-classes';

// HLS.js attaches these properties to media elements at runtime
interface HlsMediaElement extends HTMLMediaElement {
  engine?: any;
  _hls?: any;
}

const OdyseeCast = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={14}
    height={14}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M2 8v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    <path d="M2 16a5 5 0 0 1 5 5M2 12a9 9 0 0 1 9 9" />
    <circle cx={2} cy={20} r={1.5} fill="currentColor" stroke="none" />
  </svg>
);

const OdyseeTheater = ({ active = false }: { active?: boolean }) => (
  <svg
    className={classnames('media-icon', PLAYER_BUTTON_CLASSES.theaterIcon)}
    width={19}
    height={19}
    fill="none"
    stroke="#fff"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <rect width={20} height={18} x={2} y={3} rx={2} ry={2} />
    <path fill="#fff" d={active ? 'M6 7h7v4H6z' : 'M6 7h12v7H6z'} />
  </svg>
);

function formatCastTime(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function CastProgressBar({ castState, castActions }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [hoverFrac, setHoverFrac] = useState(null);

  const fraction = castState.duration > 0 ? castState.currentTime / castState.duration : 0;

  const getFracFromEvent = (e) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const handlePointerDown = useCallback(
    (e) => {
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      const f = getFracFromEvent(e);
      castActions.seek(f * castState.duration);
    },
    [castActions, castState.duration]
  );

  const handlePointerMove = useCallback(
    (e) => {
      const f = getFracFromEvent(e);
      setHoverFrac(f);
      if (dragging) {
        castActions.seek(f * castState.duration);
      }
    },
    [dragging, castActions, castState.duration]
  );

  const handlePointerUp = useCallback(() => setDragging(false), []);
  const handlePointerLeave = useCallback(() => setHoverFrac(null), []);

  const displayFrac = dragging && hoverFrac !== null ? hoverFrac : fraction;

  return (
    <div
      ref={trackRef}
      className={classnames('media-slider media-slider--time', PROGRESS_CONTROL_CLASSES.slider, CAST_CLASSES.slider)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{ cursor: 'pointer' }}
    >
      <div className={classnames('media-slider__track', PROGRESS_CONTROL_CLASSES.track, CAST_CLASSES.sliderTrack)}>
        <div
          className={classnames('media-slider__fill', PROGRESS_CONTROL_CLASSES.fill, CAST_CLASSES.sliderFill)}
          style={{ width: `${displayFrac * 100}%` }}
        />
        {hoverFrac !== null && (
          <div className={CAST_CLASSES.sliderHoverFill} style={{ width: `${hoverFrac * 100}%` }} />
        )}
      </div>
      <div
        className={classnames('media-slider__thumb', PROGRESS_CONTROL_CLASSES.thumb, CAST_CLASSES.sliderThumb)}
        style={{ left: `${displayFrac * 100}%`, display: 'block' }}
      />
      {hoverFrac !== null && (
        <div
          className={SLIDER_PREVIEW_CLASSES.root}
          style={{
            position: 'absolute',
            left: `${hoverFrac * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <span className={SLIDER_PREVIEW_CLASSES.time}>{formatCastTime(hoverFrac * castState.duration)}</span>
        </div>
      )}
    </div>
  );
}

function CastVolumeSlider({ castState, castActions }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const getFracFromEvent = (e) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const handlePointerDown = useCallback(
    (e) => {
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      castActions.setVolume(getFracFromEvent(e));
    },
    [castActions]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (dragging) castActions.setVolume(getFracFromEvent(e));
    },
    [dragging, castActions]
  );

  const handlePointerUp = useCallback(() => setDragging(false), []);

  return (
    <div
      ref={trackRef}
      className={classnames('media-slider', VOLUME_CONTROL_CLASSES.slider)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="media-slider__track">
        <div className="media-slider__fill" style={{ width: `${castState.volume * 100}%` }} />
      </div>
      <div className="media-slider__thumb" style={{ left: `${castState.volume * 100}%`, display: 'block' }} />
    </div>
  );
}

const OdyseePlay = icons[ICONS.PLAY];
const OdyseeReplay = icons[ICONS.REPLAY];
const OdyseePlayPrevious = icons[ICONS.PLAY_PREVIOUS];
const OdyseeVolumeMuted = icons[ICONS.VOLUME_MUTED];
const OdyseeInfo = icons[ICONS.INFO];
const OdyseeCommentsList = icons[ICONS.COMMENTS_LIST];
const OdyseeChat = icons[ICONS.CHAT];
const OdyseeDiscover = icons[ICONS.DISCOVER];
const OdyseeAutoplayNext = icons[ICONS.AUTOPLAY_NEXT];
const OdyseeSettings = icons[ICONS.SETTINGS];
const OdyseeRepeat = icons[ICONS.REPEAT];
const OdyseeCamera = icons[ICONS.CAMERA];
const OdyseeCopyLink = icons[ICONS.COPY_LINK];
const OdyseeTime = icons[ICONS.TIME];
const OdyseeEmbed = icons[ICONS.EMBED];

const Btn = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function Btn(
  { className, ...props },
  ref
) {
  return <button ref={ref} type="button" className={`media-button ${className || ''}`} {...props} />;
});

function PlayLabel() {
  const paused = Player.usePlayer((s) => Boolean(s.paused));
  const ended = Player.usePlayer((s) => Boolean(s.ended));
  if (ended) return 'Replay';
  return paused ? __('Play (space)') : __('Pause (space)');
}

function CaptionsLabel() {
  return Player.usePlayer((s) => Boolean(s.subtitlesShowing)) ? __('Disable captions') : __('Enable captions');
}

function handleSnapshotFn(media, title) {
  if (!media) return;
  const video = media.closest ? media : document.querySelector('video');
  if (!video) return;
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = Object.assign(document.createElement('canvas'), {
    width,
    height,
  });
  canvas.getContext('2d').drawImage(video, 0, 0, width, height);
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/jpeg');
  link.download =
    (title || 'snapshot')
      .replace(/[^\p{L}\p{N}\p{P}\p{Z}^$\n]/gu, '')
      .replace(/\s+$/, '')
      .replace(/\.$/, '') + '.jpg';
  link.click();
  link.remove();
  canvas.remove();
}

const COMMON_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
function snapHeight(h) {
  for (const c of COMMON_HEIGHTS) {
    if (h <= c) return c;
  }
  return h;
}

function getQualityHeight(level) {
  return level?.width && level?.height && level.height > level.width ? level.width : level?.height || 0;
}

function getInitialQualityLevelIndex(levels, defaultQuality) {
  const targetHeight = Number(defaultQuality);
  if (!Number.isFinite(targetHeight) || targetHeight <= 0 || !levels?.length) {
    return null;
  }

  const candidates = levels
    .map((level, index) => ({
      index,
      height: getQualityHeight(level),
      bitrate: level?.bitrate || 0,
    }))
    .filter((level) => level.height > 0)
    .sort((a, b) => {
      if (b.height !== a.height) return b.height - a.height;
      return b.bitrate - a.bitrate;
    });

  return (
    candidates.find((level) => level.height <= targetHeight)?.index ?? candidates[candidates.length - 1]?.index ?? null
  );
}

function useQualityLevels({
  defaultQuality,
  hasOriginalSource,
  isOriginalSourceSelected,
  onSelectOriginalSource,
  onSelectAdaptiveSource,
}) {
  const media = Player.useMedia();
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [activeHeight, setActiveHeight] = useState(0);
  const pendingLevelRef = useRef<number | null>(null);
  const initialQualityHlsRef = useRef<any>(null);
  const userSelectedQualityRef = useRef(false);

  useEffect(() => {
    if (isOriginalSourceSelected) {
      setCurrentLevel(-2);
    }
  }, [isOriginalSourceSelected]);

  useEffect(() => {
    initialQualityHlsRef.current = null;
    userSelectedQualityRef.current = false;
  }, [defaultQuality, media]);

  useEffect(() => {
    if (!media) return;

    let hls = (media as HlsMediaElement).engine || (media as HlsMediaElement)._hls;
    if (hls) setup(hls);

    const interval = setInterval(() => {
      const h = (media as HlsMediaElement).engine || (media as HlsMediaElement)._hls;
      if (h && h !== hls) {
        hls = h;
        setup(h);
      }
    }, 500);

    let onParsed, onSwitched, onFragChanged;

    function setup(h) {
      clearInterval(interval);
      const applyInitialQuality = () => {
        if (!defaultQuality || defaultQuality === QUALITY_OPTIONS.AUTO || initialQualityHlsRef.current === h) return;
        if (userSelectedQualityRef.current) return;

        if (defaultQuality === QUALITY_OPTIONS.ORIGINAL) {
          if (!hasOriginalSource || isOriginalSourceSelected) return;
          initialQualityHlsRef.current = h;
          if (onSelectOriginalSource) onSelectOriginalSource();
          setCurrentLevel(-2);
          return;
        }

        const levelIndex = getInitialQualityLevelIndex(h.levels, defaultQuality);
        if (levelIndex === null) return;

        h.currentLevel = levelIndex;
        h.loadLevel = levelIndex;
        h.nextLevel = levelIndex;
        h.startLevel = levelIndex;
        initialQualityHlsRef.current = h;
        setCurrentLevel(levelIndex);
      };
      const updateLevels = () => {
        if (h.levels) {
          setLevels(
            h.levels.map((l, i) => {
              // For portrait streams (height > width), use the shorter dimension
              const qualityHeight = getQualityHeight(l);
              return { height: qualityHeight, index: i };
            })
          );
          applyInitialQuality();
          if (pendingLevelRef.current !== null) {
            h.currentLevel = pendingLevelRef.current;
            setCurrentLevel(pendingLevelRef.current);
            pendingLevelRef.current = null;
          } else if (!isOriginalSourceSelected) {
            setCurrentLevel(h.currentLevel);
          }
          const playing = h.currentLevel >= 0 ? h.currentLevel : h.loadLevel >= 0 ? h.loadLevel : -1;
          const playingLevel = playing >= 0 && h.levels[playing] ? h.levels[playing] : null;
          const playingHeight = getQualityHeight(playingLevel);
          setActiveHeight(playingHeight);
        }
      };
      updateLevels();
      onParsed = updateLevels;
      onSwitched = () => {
        if (isOriginalSourceSelected) return;
        setCurrentLevel(h.currentLevel);
        const playing = h.currentLevel >= 0 ? h.currentLevel : h.loadLevel >= 0 ? h.loadLevel : -1;
        const lvl = playing >= 0 && h.levels[playing] ? h.levels[playing] : null;
        setActiveHeight(getQualityHeight(lvl));
      };
      onFragChanged = (_, data) => {
        if (data && data.frag && data.frag.level >= 0 && h.levels[data.frag.level]) {
          setActiveHeight(getQualityHeight(h.levels[data.frag.level]));
        }
      };
      if (h.on) {
        h.on('hlsManifestParsed', onParsed);
        h.on('hlsLevelSwitched', onSwitched);
        h.on('hlsFragChanged', onFragChanged);
      }
    }

    return () => {
      clearInterval(interval);
      if (hls && hls.off) {
        if (onParsed) hls.off('hlsManifestParsed', onParsed);
        if (onSwitched) hls.off('hlsLevelSwitched', onSwitched);
        if (onFragChanged) hls.off('hlsFragChanged', onFragChanged);
      }
    };
  }, [defaultQuality, hasOriginalSource, isOriginalSourceSelected, media]);

  const selectQuality = useCallback(
    (levelIndex) => {
      userSelectedQualityRef.current = true;
      if (levelIndex === -2) {
        if (!hasOriginalSource) return;
        if (onSelectOriginalSource) onSelectOriginalSource();
        setCurrentLevel(-2);
        return;
      }

      if (onSelectAdaptiveSource) onSelectAdaptiveSource();
      const hls = (media as HlsMediaElement | null)?.engine || (media as HlsMediaElement | null)?._hls;
      if (!hls) {
        pendingLevelRef.current = levelIndex;
        setCurrentLevel(levelIndex);
        return;
      }
      hls.currentLevel = levelIndex;
      setCurrentLevel(levelIndex);
    },
    [hasOriginalSource, media, onSelectAdaptiveSource, onSelectOriginalSource]
  );

  const autoLabel = activeHeight > 0 ? `${__('Auto')} (${snapHeight(activeHeight)}p)` : __('Auto');
  const currentLabel =
    currentLevel === -2
      ? __('Original')
      : currentLevel === -1
        ? autoLabel
        : levels[currentLevel]
          ? `${snapHeight(levels[currentLevel].height)}p`
          : autoLabel;

  const isHD = activeHeight >= 720;

  return {
    levels,
    currentLevel,
    currentLabel,
    selectQuality,
    isHD,
    activeHeight,
    hasOriginalSource,
  };
}

function SettingsToggle({ on }: { on: boolean }) {
  return (
    <span className={classnames(MEDIA_SETTINGS_MENU_CLASSES.toggle, on && MEDIA_SETTINGS_MENU_CLASSES.toggleOn)}>
      <span
        className={classnames(MEDIA_SETTINGS_MENU_CLASSES.toggleKnob, on && MEDIA_SETTINGS_MENU_CLASSES.toggleKnobOn)}
      />
    </span>
  );
}

function SettingsMenuContent({
  isMarkdownOrComment,
  isLivestream,
  onToggleAutoplayNext,
  autoplayNext,
  floatingPlayer,
  onToggleFloatingPlayer,
  autoplayMedia,
  onToggleAutoplayMedia,
  title,
  onShowShortcuts,
  onCloseMenu,
  quality,
  isFloating,
  embedded,
  externalEmbed,
  isCasting,
}) {
  const isMobileDevice = platform.isMobile();
  const { levels, currentLevel, currentLabel, selectQuality } = quality;
  const [view, setView] = useState('main');
  const media = Player.useMedia();
  const rate = Player.usePlayer((s) => s.playbackRate) || 1;
  const rateLabel = `${rate}x`;
  const isExternalEmbedPlayback = Boolean(externalEmbed || isEmbedPath(window.location.pathname));

  const handleSelectRate = useCallback(
    (r) => {
      if (media) media.playbackRate = r;
      setView('main');
    },
    [media]
  );

  const isShorts =
    !!document.querySelector('.shorts-page__container') || !!document.querySelector('[data-floating-shorts-player]');
  const [looped, setLooped] = usePersistedState('video-loop', false);
  React.useEffect(() => {
    if (media) media.loop = looped;
  }, [media, looped]);
  const handleToggleLoop = useCallback(() => {
    setLooped((prev: boolean) => {
      const next = !prev;
      if (media) media.loop = next;
      return next;
    });
  }, [media, setLooped]);

  const [localFloating, setLocalFloating] = useState(floatingPlayer);
  const handleToggleFloating = useCallback(() => {
    setLocalFloating((v) => !v);
    if (onToggleFloatingPlayer) onToggleFloatingPlayer();
  }, [onToggleFloatingPlayer]);

  const [localAutoplay, setLocalAutoplay] = useState(autoplayMedia);
  const handleToggleAutoplay = useCallback(() => {
    setLocalAutoplay((v) => !v);
    if (onToggleAutoplayMedia) onToggleAutoplayMedia();
  }, [onToggleAutoplayMedia]);

  const [localAutoplayNext, setLocalAutoplayNext] = useState(autoplayNext);
  const handleToggleAutoplayNext = useCallback(() => {
    setLocalAutoplayNext((v) => !v);
    if (onToggleAutoplayNext) onToggleAutoplayNext();
  }, [onToggleAutoplayNext]);

  const handleSnapshot = useCallback(() => {
    handleSnapshotFn(media, title);
    if (onCloseMenu) onCloseMenu();
  }, [media, title, onCloseMenu]);

  const handleShowShortcuts = useCallback(() => {
    if (onShowShortcuts) onShowShortcuts();
    if (onCloseMenu) onCloseMenu();
  }, [onShowShortcuts, onCloseMenu]);

  if (view === 'quality') {
    return (
      <div key="quality" className={MEDIA_SETTINGS_MENU_CLASSES.menu}>
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.back} onClick={() => setView('main')}>
          <svg
            className={MEDIA_SETTINGS_MENU_CLASSES.backIcon}
            width={12}
            height={12}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {__('Quality')}
        </button>
        {levels
          .slice()
          .sort((a, b) => b.height - a.height)
          .map((level) => (
            <button
              key={level.index}
              type="button"
              className={classnames(
                MEDIA_SETTINGS_MENU_CLASSES.option,
                currentLevel === level.index
                  ? MEDIA_SETTINGS_MENU_CLASSES.optionSelected
                  : MEDIA_SETTINGS_MENU_CLASSES.optionHover
              )}
              onClick={() => {
                selectQuality(level.index);
                setView('main');
              }}
            >
              {snapHeight(level.height)}p
            </button>
          ))}
        {!isLivestream && quality.hasOriginalSource && (
          <button
            type="button"
            className={classnames(
              MEDIA_SETTINGS_MENU_CLASSES.option,
              currentLevel === -2 ? MEDIA_SETTINGS_MENU_CLASSES.optionSelected : MEDIA_SETTINGS_MENU_CLASSES.optionHover
            )}
            onClick={() => {
              selectQuality(-2);
              setView('main');
            }}
          >
            {__('Original')}
          </button>
        )}
        <button
          type="button"
          className={classnames(
            MEDIA_SETTINGS_MENU_CLASSES.option,
            currentLevel === -1 ? MEDIA_SETTINGS_MENU_CLASSES.optionSelected : MEDIA_SETTINGS_MENU_CLASSES.optionHover
          )}
          onClick={() => {
            selectQuality(-1);
            setView('main');
          }}
        >
          {__('Auto')}
        </button>
      </div>
    );
  }

  if (view === 'speed') {
    return (
      <div key="speed" className={MEDIA_SETTINGS_MENU_CLASSES.menu}>
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.back} onClick={() => setView('main')}>
          <svg
            className={MEDIA_SETTINGS_MENU_CLASSES.backIcon}
            width={12}
            height={12}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {__('Playback Speed')}
        </button>
        {VIDEO_PLAYBACK_RATES.map((r) => (
          <button
            key={r}
            type="button"
            className={classnames(
              MEDIA_SETTINGS_MENU_CLASSES.option,
              r === rate ? MEDIA_SETTINGS_MENU_CLASSES.optionSelected : MEDIA_SETTINGS_MENU_CLASSES.optionHover
            )}
            onClick={() => handleSelectRate(r)}
          >
            {`${r}x`}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div key="main" className={MEDIA_SETTINGS_MENU_CLASSES.menu}>
      {!isMobileDevice && !isExternalEmbedPlayback && !isShorts && (
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.item} onClick={handleShowShortcuts}>
          <svg
            className={MEDIA_SETTINGS_MENU_CLASSES.icon}
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x={2} y={4} width={20} height={16} rx={2} />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
          </svg>
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Keyboard shortcuts')}</span>
        </button>
      )}
      {!isMobileDevice && (
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.item} onClick={handleSnapshot}>
          <OdyseeCamera className={MEDIA_SETTINGS_MENU_CLASSES.icon} size={16} color="currentColor" />
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Take snapshot')}</span>
        </button>
      )}
      {!isExternalEmbedPlayback && (
        <button
          type="button"
          className={classnames(
            MEDIA_SETTINGS_MENU_CLASSES.item,
            isFloating && MEDIA_SETTINGS_MENU_CLASSES.itemDisabled
          )}
          onClick={isFloating ? undefined : handleToggleFloating}
        >
          <svg
            className={MEDIA_SETTINGS_MENU_CLASSES.icon}
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <rect x="7.5" y="6.5" width="9" height="7" rx="1" fill="currentColor" stroke="none" />
          </svg>
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Floating Player')}</span>
          <SettingsToggle on={localFloating} />
        </button>
      )}
      {!isExternalEmbedPlayback && (
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.item} onClick={handleToggleAutoplay}>
          <svg
            className={MEDIA_SETTINGS_MENU_CLASSES.icon}
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
          </svg>
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Autoplay')}</span>
          <SettingsToggle on={localAutoplay} />
        </button>
      )}
      {!isExternalEmbedPlayback && !isMarkdownOrComment && onToggleAutoplayNext && !isShorts && (
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.item} onClick={handleToggleAutoplayNext}>
          <OdyseeAutoplayNext className={MEDIA_SETTINGS_MENU_CLASSES.icon} size={16} />
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Autoplay Next')}</span>
          <SettingsToggle on={localAutoplayNext} />
        </button>
      )}
      {!isExternalEmbedPlayback && !isShorts && (
        <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.item} onClick={handleToggleLoop}>
          <OdyseeRepeat className={MEDIA_SETTINGS_MENU_CLASSES.icon} size={16} color="currentColor" />
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Loop')}</span>
          <SettingsToggle on={looped} />
        </button>
      )}
      <button type="button" className={MEDIA_SETTINGS_MENU_CLASSES.item} onClick={() => setView('speed')}>
        <svg
          className={MEDIA_SETTINGS_MENU_CLASSES.icon}
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
          <path d="M12 12l4-4" />
          <circle cx={12} cy={12} r={1.5} fill="currentColor" stroke="none" />
        </svg>
        <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Playback Speed')}</span>
        <span className={MEDIA_SETTINGS_MENU_CLASSES.value}>{rateLabel}</span>
      </button>
      {!isCasting && (
        <button
          type="button"
          className={MEDIA_SETTINGS_MENU_CLASSES.item}
          disabled={levels.length === 0}
          onClick={() => setView('quality')}
        >
          <svg
            className={MEDIA_SETTINGS_MENU_CLASSES.icon}
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1={4} y1={21} x2={4} y2={14} />
            <line x1={4} y1={10} x2={4} y2={3} />
            <line x1={12} y1={21} x2={12} y2={12} />
            <line x1={12} y1={8} x2={12} y2={3} />
            <line x1={20} y1={21} x2={20} y2={16} />
            <line x1={20} y1={12} x2={20} y2={3} />
            <line x1={1} y1={14} x2={7} y2={14} />
            <line x1={9} y1={8} x2={15} y2={8} />
            <line x1={17} y1={16} x2={23} y2={16} />
          </svg>
          <span className={MEDIA_SETTINGS_MENU_CLASSES.label}>{__('Quality')}</span>
          <span className={MEDIA_SETTINGS_MENU_CLASSES.value}>{levels.length > 0 ? currentLabel : __('Original')}</span>
        </button>
      )}
    </div>
  );
}

function ClickToPlay({ onTogglePlay, isFloating }) {
  const media = Player.useMedia();
  const settingsWasOpenRef = useRef(false);
  const clickTimerRef = useRef(null);

  useEffect(() => {
    const onPointerDown = () => {
      settingsWasOpenRef.current = Boolean(document.querySelector('.media-button--settings-open'));
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (settingsWasOpenRef.current) {
      settingsWasOpenRef.current = false;
      return;
    }
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (onTogglePlay) {
        onTogglePlay();
      } else if (media) {
        if (media.paused) {
          media.play();
        } else {
          media.pause();
        }
      }
    }, 200);
  }, [media, onTogglePlay]);

  const handleDblClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  return (
    <div
      className={classnames(CLICK_TO_PLAY_CLASS, isFloating && CLICK_TO_PLAY_FLOATING_CLASS)}
      onClick={handleClick}
      onDoubleClick={handleDblClick}
    />
  );
}

function useLiveTimeFormat() {
  const duration = Player.usePlayer((s) => s.duration) || 0;
  return useCallback(
    (value) => {
      const diff = Math.round(value - duration);
      if (diff >= 0) return '0:00';
      const abs = Math.abs(diff);
      const m = Math.floor(abs / 60);
      const s = abs % 60;
      return `-${m}:${s < 10 ? '0' : ''}${s}`;
    },
    [duration]
  );
}

function chapterFormatFn(chapters) {
  return (seconds) => {
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (seconds >= chapters[i].time) return chapters[i].label;
    }
    return '';
  };
}

function ChapterMarkers({ chapters }) {
  const duration = Player.usePlayer((s) => s.duration) || 0;

  if (!chapters || chapters.length < 2 || !duration) return null;

  return (
    <div className={CHAPTER_CLASSES.markers}>
      {chapters.slice(1).map((ch, i) => (
        <div key={i} className={CHAPTER_CLASSES.marker} style={{ left: `${(ch.time / duration) * 100}%` }} />
      ))}
    </div>
  );
}

function ChapterPill({ chapters }) {
  const currentTime = Player.usePlayer((s) => s.currentTime) || 0;

  if (!chapters || chapters.length === 0) return null;

  let activeChapter = null;
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (currentTime >= chapters[i].time) {
      activeChapter = chapters[i];
      break;
    }
  }

  if (!activeChapter) return null;

  return (
    <div className={classnames('media-surface odysee-controls', CHAPTER_CLASSES.pill)}>
      <Btn
        className={classnames('media-button--icon', CHAPTER_CLASSES.pillButton)}
        onClick={() => window.dispatchEvent(new CustomEvent('toggleChaptersCard'))}
      >
        <span className={CHAPTER_CLASSES.pillLabel}>{activeChapter.label}</span>
      </Btn>
    </div>
  );
}

function LiveButton() {
  const media = Player.useMedia();
  const currentTime = Player.usePlayer((s) => s.currentTime) || 0;
  const [atEdge, setAtEdge] = useState(true);
  const atEdgeRef = useRef(true);

  const getLiveSyncPosition = useCallback(() => {
    if (!media) return null;
    const hls = (media as HlsMediaElement)._hls;
    if (hls && hls.liveSyncPosition != null) return hls.liveSyncPosition;
    if (media.seekable && media.seekable.length > 0) {
      return media.seekable.end(media.seekable.length - 1) - 4;
    }
    return null;
  }, [media]);

  useEffect(() => {
    if (!media) return;
    const check = () => {
      const syncPos = getLiveSyncPosition();
      if (syncPos != null) {
        const behind = syncPos - media.currentTime;
        const next = atEdgeRef.current ? behind < 10 : behind < 5;
        if (next !== atEdgeRef.current) {
          atEdgeRef.current = next;
          setAtEdge(next);
        }
      }
    };
    check();
    media.addEventListener('timeupdate', check);
    return () => media.removeEventListener('timeupdate', check);
  }, [media, currentTime, getLiveSyncPosition]);

  const seekToLive = useCallback(() => {
    const syncPos = getLiveSyncPosition();
    if (syncPos != null && media) {
      media.currentTime = syncPos;
    }
  }, [media, getLiveSyncPosition]);

  return (
    <button
      type="button"
      className={classnames(LIVE_BUTTON_CLASSES.root, atEdge && LIVE_BUTTON_CLASSES.atEdge)}
      onClick={seekToLive}
    >
      <span className={LIVE_BUTTON_CLASSES.dot} />
      {__('LIVE')}
    </button>
  );
}

function P2PTrafficGlyph({ transferDirection, active = false }) {
  if (!transferDirection || transferDirection === 'none') return null;

  return (
    <span className={P2P_CLASSES.traffic} aria-hidden="true">
      {(transferDirection === 'download' || transferDirection === 'both') && (
        <svg
          className={classnames(P2P_CLASSES.arrow, active && P2P_CLASSES.arrowActive)}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
        >
          <path
            d="M5 1.5v5.1M3 4.6 5 6.7l2-2.1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {(transferDirection === 'upload' || transferDirection === 'both') && (
        <svg
          className={classnames(P2P_CLASSES.arrow, active && P2P_CLASSES.arrowActive)}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
        >
          <path
            d="M5 8.5V3.4M3 5.4 5 3.3l2 2.1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

function formatP2PThroughput(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null;
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;

  const kiloBytesPerSecond = bytesPerSecond / 1024;
  if (kiloBytesPerSecond < 1024) {
    return `${kiloBytesPerSecond >= 100 ? Math.round(kiloBytesPerSecond) : kiloBytesPerSecond.toFixed(1)} KB/s`;
  }

  const megaBytesPerSecond = kiloBytesPerSecond / 1024;
  return `${megaBytesPerSecond >= 10 ? megaBytesPerSecond.toFixed(1) : megaBytesPerSecond.toFixed(2)} MB/s`;
}

function P2PControl({ isLivestream, p2pEnabled, p2pUiState, compact = false, onToggle }) {
  if (!isLivestream) return null;

  const peerCount = p2pUiState?.peerCount || 0;
  const status = p2pUiState?.status || (p2pEnabled ? 'enabled' : 'off');
  const transferDirection = p2pUiState?.transferDirection || 'none';
  const downloadRateLabel = formatP2PThroughput(p2pUiState?.downloadRateBps || 0);
  const uploadRateLabel = formatP2PThroughput(p2pUiState?.uploadRateBps || 0);
  const showIndicator = p2pEnabled && (peerCount > 0 || status === 'active');
  const peerLabel = peerCount > 0 ? `${peerCount} ${peerCount === 1 ? __('peer') : __('peers')}` : __('P2P');
  const throughputLabel =
    compact || status !== 'active'
      ? null
      : transferDirection === 'both' && downloadRateLabel && uploadRateLabel
        ? `${downloadRateLabel} / ${uploadRateLabel}`
        : downloadRateLabel || uploadRateLabel || null;
  const buttonLabel = !p2pEnabled
    ? __('Enable P2P delivery')
    : status === 'active'
      ? __('P2P delivery active - click to disable')
      : peerCount > 0
        ? __('P2P peering active - click to disable')
        : __('P2P delivery active - click to disable');
  const indicatorTitle =
    status === 'active'
      ? `${peerLabel} • ${
          transferDirection === 'both'
            ? __('Downloading and uploading')
            : transferDirection === 'download'
              ? __('Downloading from peers')
              : __('Uploading to peers')
        }`
      : peerLabel;

  return (
    <div className={classnames(P2P_CLASSES.control, compact && P2P_CLASSES.controlCompact)}>
      <button
        type="button"
        className={classnames(
          P2P_CLASSES.button,
          p2pEnabled && P2P_CLASSES.buttonEnabled,
          status === 'active' && P2P_CLASSES.buttonActive
        )}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={onToggle}
      >
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
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </button>
      {showIndicator && (
        <span
          className={classnames(
            P2P_CLASSES.indicator,
            status === 'peered' && P2P_CLASSES.indicatorPeered,
            status === 'active' && P2P_CLASSES.indicatorActive,
            compact && P2P_CLASSES.indicatorCompact
          )}
          title={indicatorTitle}
        >
          <span className={classnames(P2P_CLASSES.dot, status === 'active' && P2P_CLASSES.dotActive)} />
          <span className={classnames(P2P_CLASSES.label, compact && P2P_CLASSES.labelCompact)}>
            {compact ? String(peerCount || 1) : peerLabel}
          </span>
          <P2PTrafficGlyph transferDirection={transferDirection} active={status === 'active'} />
          {throughputLabel && (
            <span className={classnames(P2P_CLASSES.speed, compact && P2P_CLASSES.speedCompact)}>
              {throughputLabel}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export default function OdyseeSkin(props) {
  const {
    children,
    className,
    isLivestream,
    isMarkdownOrComment,
    onToggleTheaterMode,
    videoTheaterMode,
    onToggleAutoplayNext,
    autoplayNext,
    floatingPlayer,
    onToggleFloatingPlayer,
    autoplayMedia,
    onToggleAutoplayMedia,
    onPlayNext,
    onPlayPrevious,
    canPlayNext,
    canPlayPrevious,
    defaultQuality,
    originalVideoWidth,
    originalVideoHeight,
    title,
    description,
    isFloating,
    embedded,
    externalEmbed,
    uri,
    castAvailable,
    isCasting,
    onCastToggle,
    castState,
    castActions,
    p2pUiState,
    hasOriginalSource,
    isOriginalSourceSelected,
    onSelectOriginalSource,
    onSelectAdaptiveSource,
    ...rest
  } = props;

  const dispatch = useAppDispatch();
  const p2pEnabled = useAppSelector((state) => selectClientSetting(state, SETTINGS.P2P_DELIVERY));
  const isMobileDevice = platform.isMobile();
  const isMobileSize = useIsMobile();
  const isShorts =
    !!document.querySelector('.shorts-page__container') || !!document.querySelector('[data-floating-shorts-player]');
  const isEmbeddedPlayback = Boolean(embedded || isEmbedPath(window.location.pathname));
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fsEnterIconRef = React.useRef(null);
  const fsExitIconRef = React.useRef(null);
  const quality = useQualityLevels({
    defaultQuality,
    hasOriginalSource,
    isOriginalSourceSelected,
    onSelectOriginalSource,
    onSelectAdaptiveSource,
  });
  const chapters = React.useMemo(() => parseChapters(description), [description]);
  const liveTimeFormat = useLiveTimeFormat();
  const isVerticalVideo = originalVideoWidth && originalVideoHeight && originalVideoHeight > originalVideoWidth;
  const isExternalEmbedPlayback = Boolean(externalEmbed || isEmbedPath(window.location.pathname));
  const isOdyseeEmbeddedPlayback = Boolean(isEmbeddedPlayback && (!isExternalEmbedPlayback || isMarkdownOrComment));
  const hasMobileControls = isMobileDevice || (isMobileSize && isFullscreen);
  const settingsPopoverClassName = classnames(
    'media-popover',
    MEDIA_SETTINGS_MENU_CLASSES.popover,
    isEmbeddedPlayback && MEDIA_SETTINGS_MENU_CLASSES.popoverEmbed,
    isExternalEmbedPlayback && MEDIA_SETTINGS_MENU_CLASSES.popoverExternalEmbed
  );

  // Detect portrait video from actual stream dimensions and add class to container
  const media = Player.useMedia();
  const [isPortraitStream, setIsPortraitStream] = useState(false);
  useEffect(() => {
    if (!media) return;
    const videoEl = media instanceof HTMLVideoElement ? media : media.querySelector?.('video');
    if (!videoEl) return;

    const checkOrientation = () => {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (vw > 0 && vh > 0) {
        setIsPortraitStream(vh > vw);
      }
    };

    videoEl.addEventListener('loadedmetadata', checkOrientation);
    videoEl.addEventListener('resize', checkOrientation);
    // Check immediately in case already loaded
    checkOrientation();

    return () => {
      videoEl.removeEventListener('loadedmetadata', checkOrientation);
      videoEl.removeEventListener('resize', checkOrientation);
    };
  }, [media]);

  const isVertical = isVerticalVideo || isPortraitStream;
  const castIsPaused = castState ? castState.isPaused : true;
  const castTogglePlay = React.useCallback(() => {
    if (!castActions) return;
    if (castIsPaused) {
      castActions.play();
    } else {
      castActions.pause();
    }
  }, [castIsPaused, castActions]);

  const [activePanel, setActivePanel] = useState(null);

  React.useEffect(() => {
    const handler = (e) => setActivePanel(e.detail.mode);
    window.addEventListener('fullscreen-panel-change', handler);
    return () => window.removeEventListener('fullscreen-panel-change', handler);
  }, []);

  React.useEffect(() => {
    const handler = () => setShowShortcuts((v) => !v);
    window.addEventListener('toggleShortcuts', handler);
    return () => window.removeEventListener('toggleShortcuts', handler);
  }, []);

  React.useLayoutEffect(() => {
    if (!settingsOpen) return;
    const isSafari = platform.isSafari();
    const noPopoverAPI =
      typeof HTMLElement.prototype.showPopover !== 'function' || (window as any).__forceLegacyPopover === true;
    if (!isFloating && !isSafari && !noPopoverAPI) return;
    let cancelled = false;
    let observer: MutationObserver | null = null;
    const triggerSel = isFloating ? '[data-floating-player] .media-button--settings' : '.media-button--settings';
    const fix = () => {
      if (cancelled) return false;
      const popup = document.querySelector<HTMLElement>('.media-popover--settings');
      const trigger = document.querySelector<HTMLElement>(triggerSel);
      if (!popup || !trigger) return false;
      if (noPopoverAPI) {
        // Strip the `popover` attribute so the UA-stylesheet rule
        // `[popover]:not(:popover-open) { display: none }` no longer applies.
        if (popup.hasAttribute('popover')) popup.removeAttribute('popover');
        popup.style.setProperty('position', 'fixed', 'important');
        popup.style.setProperty('inset', 'auto', 'important');
        popup.style.setProperty('margin', '0', 'important');
        popup.style.setProperty('z-index', '2147483647', 'important');
        // Probe the containing block. Temporarily neutralize transform/translate
        // so the bounding rect reflects the un-transformed origin, then restore
        // them so the modern transition (scale/translate) can animate.
        const prevTranslate = popup.style.getPropertyValue('translate');
        const prevTransform = popup.style.getPropertyValue('transform');
        popup.style.setProperty('translate', 'none', 'important');
        popup.style.setProperty('transform', 'none', 'important');
        popup.style.setProperty('top', '0px', 'important');
        popup.style.setProperty('left', '0px', 'important');
        const probe = popup.getBoundingClientRect();
        const dx = probe.left;
        const dy = probe.top;
        const ph = popup.offsetHeight;
        const pw = popup.offsetWidth;
        // Restore (or clear) so CSS animations on these properties run.
        if (prevTranslate) popup.style.setProperty('translate', prevTranslate);
        else popup.style.removeProperty('translate');
        if (prevTransform) popup.style.setProperty('transform', prevTransform);
        else popup.style.removeProperty('transform');
        const tr = trigger.getBoundingClientRect();
        const fitsAbove = tr.top - ph - 4 >= 0;
        const topPos = fitsAbove ? tr.top - ph - 4 : tr.bottom + 4;
        const leftClamped = Math.max(8, Math.min(window.innerWidth - pw - 8, tr.right - pw));
        popup.style.setProperty('top', `${topPos - dy}px`, 'important');
        popup.style.setProperty('left', `${leftClamped - dx}px`, 'important');
      } else {
        const tr = trigger.getBoundingClientRect();
        const ph = popup.offsetHeight;
        const pw = popup.offsetWidth;
        const fitsAbove = tr.top - ph - 4 >= 0;
        const topPos = fitsAbove ? tr.top - ph - 4 : tr.bottom + 4;
        popup.style.setProperty('bottom', 'auto', 'important');
        popup.style.setProperty('top', `${topPos}px`, 'important');
        popup.style.setProperty('left', `${tr.right - pw + 12}px`, 'important');
        popup.style.setProperty('place-self', 'normal', 'important');
        popup.style.setProperty('margin-inline-start', '0', 'important');
      }
      return true;
    };
    // Try immediately; if the popup hasn't mounted yet, watch for it.
    if (!fix()) {
      observer = new MutationObserver(() => {
        if (fix() && observer) {
          observer.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => fix()));
    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
    };
  }, [settingsOpen, isFloating]);

  React.useEffect(() => {
    if (typeof HTMLElement.prototype.showPopover === 'function') return;
    if (typeof MutationObserver === 'undefined') return;
    const controls = document.querySelector('.media-controls');
    const progressBar = document.querySelector('.odysee-progress-bar');
    if (!controls || !progressBar) return;
    const sync = () => {
      if (controls.hasAttribute('data-visible')) {
        (progressBar as HTMLElement).style.removeProperty('opacity');
        (progressBar as HTMLElement).style.removeProperty('pointer-events');
      } else {
        (progressBar as HTMLElement).style.setProperty('opacity', '0');
        (progressBar as HTMLElement).style.setProperty('pointer-events', 'none');
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(controls, { attributes: true, attributeFilter: ['data-visible'] });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const syncFsIcons = () => {
      const shortsContainer = document.querySelector('.shorts-page__container');
      const fsTarget = document.querySelector('.player-fullscreen-target');
      const fsEl = getFullscreenElement();
      const isFs = (!!fsTarget && fsEl === fsTarget) || (!!shortsContainer && fsEl === shortsContainer);
      setIsFullscreen(isFs);
      if (fsEnterIconRef.current) fsEnterIconRef.current.style.display = isFs ? 'none' : '';
      if (fsExitIconRef.current) fsExitIconRef.current.style.display = isFs ? '' : 'none';
    };
    syncFsIcons();
    onFullscreenChange(document, 'add', syncFsIcons);
    return () => onFullscreenChange(document, 'remove', syncFsIcons);
  }, [isFullscreen]);

  // ----- Custom right-click context menu --------------------------------
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  // `usePersistedState('video-loop', ...)` is shared across instances via the
  // listener mechanism in use-persisted-state — toggling here also updates
  // the settings menu's loop toggle.
  const [looped, setLooped] = usePersistedState('video-loop', false);
  const [ctxAutoplayMedia, setCtxAutoplayMedia] = useState(autoplayMedia);
  const [ctxAutoplayNext, setCtxAutoplayNext] = useState(autoplayNext);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement)?.closest?.('[data-odysee-context-menu]')) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(ev.target as Node)) return;
      closeContextMenu();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeContextMenu();
    };
    const onScrollOrResize = () => closeContextMenu();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [contextMenu, closeContextMenu]);

  // Clamp the menu to the viewport once it's rendered.
  useEffect(() => {
    if (!contextMenu) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = contextMenu.x;
    let ny = contextMenu.y;
    if (nx + rect.width > vw - 4) nx = Math.max(4, vw - rect.width - 4);
    if (ny + rect.height > vh - 4) ny = Math.max(4, vh - rect.height - 4);
    if (nx !== contextMenu.x || ny !== contextMenu.y) setContextMenu({ x: nx, y: ny });
  }, [contextMenu]);

  const copyText = useCallback(
    (text: string, successMsg: string, failureMsg: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => dispatch(doToast({ message: __(successMsg) })))
        .catch(() => dispatch(doToast({ message: __(failureMsg), isError: true })));
    },
    [dispatch]
  );

  const getCurrentVideo = useCallback((): HTMLVideoElement | null => {
    if (media instanceof HTMLVideoElement) return media;
    return (media as Element | null)?.querySelector?.('video') || document.querySelector('video');
  }, [media]);

  const ctxToggleLoop = useCallback(() => {
    setLooped((prev: boolean) => {
      const next = !prev;
      if (media) (media as HTMLMediaElement).loop = next;
      return next;
    });
    closeContextMenu();
  }, [media, setLooped, closeContextMenu]);

  const ctxTogglePip = useCallback(() => {
    const video = getCurrentVideo();
    if (!video) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      video.disablePictureInPicture = false;
      video.requestPictureInPicture().catch(() => {});
    }
    closeContextMenu();
  }, [getCurrentVideo, closeContextMenu]);

  const ctxCast = useCallback(() => {
    if (onCastToggle) onCastToggle();
    closeContextMenu();
  }, [onCastToggle, closeContextMenu]);

  const ctxCopyUrl = useCallback(() => {
    if (!uri) return closeContextMenu();
    const url = generateShareUrl(CTX_SHARE_DOMAIN, uri, '', false, false, 0, undefined, undefined as any);
    copyText(url, 'Link copied.', 'Failed to copy link.');
    closeContextMenu();
  }, [uri, copyText, closeContextMenu]);

  const ctxCopyUrlAtTime = useCallback(() => {
    if (!uri) return closeContextMenu();
    const t = Math.floor(getCurrentVideo()?.currentTime || 0);
    const url = generateShareUrl(CTX_SHARE_DOMAIN, uri, '', false, true, t, undefined, undefined as any);
    copyText(url, 'Link with timestamp copied.', 'Failed to copy link.');
    closeContextMenu();
  }, [uri, getCurrentVideo, copyText, closeContextMenu]);

  const ctxToggleAutoplay = useCallback(() => {
    setCtxAutoplayMedia((v) => !v);
    if (onToggleAutoplayMedia) onToggleAutoplayMedia();
    closeContextMenu();
  }, [onToggleAutoplayMedia, closeContextMenu]);

  const ctxToggleAutoplayNext = useCallback(() => {
    setCtxAutoplayNext((v) => !v);
    if (onToggleAutoplayNext) onToggleAutoplayNext();
    closeContextMenu();
  }, [onToggleAutoplayNext, closeContextMenu]);

  const ctxCopyEmbed = useCallback(() => {
    if (!uri) return closeContextMenu();
    const src = generateEmbedUrl(uri);
    const { html } = generateEmbedIframeData(src);
    copyText(html, 'Embed code copied.', 'Failed to copy embed code.');
    closeContextMenu();
  }, [uri, copyText, closeContextMenu]);

  const pipSupported =
    typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';

  return (
    <Player.Container
      onContextMenu={handleContextMenu}
      className={classnames(
        'media-default-skin media-default-skin--video',
        PLAYER_SKIN_CLASSES.root,
        isCasting && PLAYER_SKIN_CLASSES.casting,
        isVertical && isShorts && PLAYER_SKIN_CLASSES.portrait,
        hasMobileControls && PLAYER_SKIN_CLASSES.mobileControls,
        className
      )}
      {...rest}
    >
      {children}

      <ClickToPlay isFloating={isFloating} onTogglePlay={isCasting ? castTogglePlay : undefined} />

      {isCasting &&
        castState &&
        castState.deviceName &&
        (isMobileDevice ? (
          <div className={classnames(CAST_CLASSES.indicator, CAST_CLASSES.indicatorMobile)}>
            <OdyseeCast />
            <span>{castState.deviceName}</span>
          </div>
        ) : (
          <div className={CAST_CLASSES.indicator}>
            <span className={CAST_CLASSES.indicatorLabel}>
              <OdyseeCast />
              <span>{__('Casting to')}</span>
            </span>
            <span className={CAST_CLASSES.indicatorDevice}>{castState.deviceName}</span>
            <button type="button" className={CAST_CLASSES.indicatorStop} onClick={onCastToggle}>
              {__('End Casting')}
            </button>
          </div>
        ))}

      <BufferingIndicator
        render={(p) => (
          <div {...p} className="media-buffering-indicator">
            <div className="media-spinner" />
          </div>
        )}
      />

      {/* Progress Bar — above the control bar */}
      <div
        className={PROGRESS_CONTROL_CLASSES.root}
        style={media ? undefined : { pointerEvents: 'none', opacity: 0.5 }}
      >
        {isCasting && castState ? (
          <CastProgressBar castState={castState} castActions={castActions} />
        ) : (
          <TimeSlider.Root className={classnames('media-slider media-slider--time', PROGRESS_CONTROL_CLASSES.slider)}>
            <Slider.Track className={classnames('media-slider__track', PROGRESS_CONTROL_CLASSES.track)}>
              <Slider.Fill className={classnames('media-slider__fill', PROGRESS_CONTROL_CLASSES.fill)} />
              <Slider.Buffer className={classnames('media-slider__buffer', PROGRESS_CONTROL_CLASSES.buffer)} />
              {chapters.length > 0 && <ChapterMarkers chapters={chapters} />}
            </Slider.Track>
            <Slider.Thumb className={classnames('media-slider__thumb', PROGRESS_CONTROL_CLASSES.thumb)} />
            <Slider.Preview className={SLIDER_PREVIEW_CLASSES.root}>
              {!isVertical ? (
                <div className={SLIDER_PREVIEW_CLASSES.thumbnailFrame}>
                  <Slider.Thumbnail className={SLIDER_PREVIEW_CLASSES.thumbnailInFrame} />
                </div>
              ) : (
                <Slider.Thumbnail className={SLIDER_PREVIEW_CLASSES.thumbnail} />
              )}
              {chapters.length > 0 && (
                <Slider.Value
                  type="pointer"
                  format={chapterFormatFn(chapters)}
                  className={SLIDER_PREVIEW_CLASSES.chapter}
                />
              )}
              <Slider.Value
                type="pointer"
                className={SLIDER_PREVIEW_CLASSES.time}
                format={isLivestream ? liveTimeFormat : undefined}
              />
            </Slider.Preview>
          </TimeSlider.Root>
        )}
      </div>

      <Controls.Root
        className={classnames(
          'media-controls',
          hasMobileControls ? MOBILE_CONTROL_LAYOUT_CLASSES.root : CONTROL_LAYOUT_CLASSES.row,
          isCasting && CONTROL_LAYOUT_CLASSES.casting,
          settingsOpen && CONTROL_LAYOUT_CLASSES.popoverOpen
        )}
        style={media ? undefined : { pointerEvents: 'none', opacity: 0.5 }}
      >
        {hasMobileControls ? (
          <>
            <div className={classnames('media-surface', MOBILE_CONTROL_LAYOUT_CLASSES.top)}>
              <CaptionsButton
                render={(p) => (
                  <Btn {...p} className="media-button--icon media-button--captions">
                    <svg
                      className="media-icon media-icon--captions-off"
                      xmlns="http://www.w3.org/2000/svg"
                      width={18}
                      height={18}
                      fill="none"
                      aria-hidden="true"
                      viewBox="0 0 18 18"
                    >
                      <rect
                        width={16.5}
                        height={12.5}
                        x={0.75}
                        y={2.75}
                        stroke="currentColor"
                        strokeWidth={1.5}
                        rx={3}
                      />
                      <rect width={3} height={1.5} x={3} y={8.5} fill="currentColor" rx={0.75} />
                      <rect width={2} height={1.5} x={13} y={8.5} fill="currentColor" rx={0.75} />
                      <rect width={4} height={1.5} x={11} y={11.5} fill="currentColor" rx={0.75} />
                      <rect width={5} height={1.5} x={7} y={8.5} fill="currentColor" rx={0.75} />
                      <rect width={7} height={1.5} x={3} y={11.5} fill="currentColor" rx={0.75} />
                    </svg>
                    <svg
                      className="media-icon media-icon--captions-on"
                      xmlns="http://www.w3.org/2000/svg"
                      width={18}
                      height={18}
                      fill="none"
                      aria-hidden="true"
                      viewBox="0 0 18 18"
                    >
                      <path
                        fill="currentColor"
                        d="M15 2a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM3.75 11.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5zm8 0a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5zm-8-3a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5zm4 0a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5zm6 0a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5z"
                      />
                    </svg>
                  </Btn>
                )}
              />

              {isFullscreen && (
                <>
                  <button
                    type="button"
                    className={classnames(
                      'media-button media-button--icon',
                      activePanel === 'info' && PLAYER_BUTTON_CLASSES.active
                    )}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('fullscreen-panel', {
                          detail: { mode: 'info' },
                        })
                      )
                    }
                  >
                    <OdyseeInfo size={18} color="currentColor" />
                  </button>
                  {chapters.length > 0 && !isEmbeddedPlayback && (
                    <button
                      type="button"
                      className={classnames(
                        'media-button media-button--icon',
                        activePanel === 'chapters' && PLAYER_BUTTON_CLASSES.active
                      )}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('fullscreen-panel', {
                            detail: { mode: 'chapters' },
                          })
                        )
                      }
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    className={classnames(
                      'media-button media-button--icon',
                      (activePanel === 'comments' || activePanel === 'chat') && PLAYER_BUTTON_CLASSES.active
                    )}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('fullscreen-panel', {
                          detail: { mode: 'comments' },
                        })
                      )
                    }
                  >
                    {isLivestream ? (
                      <OdyseeChat size={18} color="currentColor" />
                    ) : (
                      <OdyseeCommentsList size={18} color="currentColor" />
                    )}
                  </button>
                  <button
                    type="button"
                    className={classnames(
                      'media-button media-button--icon',
                      activePanel === 'related' && PLAYER_BUTTON_CLASSES.active
                    )}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('fullscreen-panel', {
                          detail: { mode: 'related' },
                        })
                      )
                    }
                  >
                    <OdyseeDiscover size={18} color="currentColor" />
                  </button>
                </>
              )}

              {isLivestream && (
                <P2PControl
                  isLivestream={Boolean(isLivestream)}
                  p2pEnabled={p2pEnabled}
                  p2pUiState={p2pUiState}
                  compact
                  onToggle={() => dispatch(doSetClientSetting(SETTINGS.P2P_DELIVERY, !p2pEnabled))}
                />
              )}

              {!isEmbeddedPlayback && (
                <Popover.Root side="bottom" open={settingsOpen} onOpenChange={(open) => setSettingsOpen(open)}>
                  <Popover.Trigger
                    render={
                      <button
                        type="button"
                        className={classnames(
                          'media-button media-button--icon',
                          PLAYER_BUTTON_CLASSES.settings,
                          settingsOpen && PLAYER_BUTTON_CLASSES.settingsOpen
                        )}
                        aria-label={__('Settings')}
                      >
                        <OdyseeSettings
                          className={classnames('media-icon', PLAYER_BUTTON_CLASSES.settingsIcon)}
                          size={18}
                          color="currentColor"
                        />
                        {(quality.isHD || (quality.levels.length === 0 && (originalVideoHeight || 0) >= 720)) && (
                          <span className={PLAYER_BUTTON_CLASSES.hdBadge}>HD</span>
                        )}
                      </button>
                    }
                  />
                  <Popover.Popup className={settingsPopoverClassName}>
                    <SettingsMenuContent
                      isMarkdownOrComment={isMarkdownOrComment}
                      isLivestream={Boolean(isLivestream)}
                      onToggleAutoplayNext={onToggleAutoplayNext}
                      autoplayNext={autoplayNext}
                      floatingPlayer={floatingPlayer}
                      onToggleFloatingPlayer={onToggleFloatingPlayer}
                      autoplayMedia={autoplayMedia}
                      onToggleAutoplayMedia={onToggleAutoplayMedia}
                      title={title}
                      onShowShortcuts={() => setShowShortcuts(true)}
                      onCloseMenu={() => setSettingsOpen(false)}
                      quality={quality}
                      isFloating={isFloating}
                      embedded={isEmbeddedPlayback}
                      externalEmbed={externalEmbed}
                      isCasting={isCasting}
                    />
                  </Popover.Popup>
                </Popover.Root>
              )}
            </div>

            <div className={MOBILE_CONTROL_LAYOUT_CLASSES.bottom}>
              <div
                className={classnames(
                  'media-surface',
                  MOBILE_CONTROL_LAYOUT_CLASSES.capsule,
                  MOBILE_CONTROL_LAYOUT_CLASSES.time
                )}
              >
                {isCasting && castState ? (
                  <Btn
                    className="media-button--icon media-button--mute"
                    onClick={() => castActions && castActions.toggleMute()}
                  >
                    {castState.isMuted ? (
                      <OdyseeVolumeMuted className="media-icon" size={18} color="currentColor" />
                    ) : (
                      <svg
                        className="media-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width={18}
                        height={18}
                        fill="none"
                        aria-hidden="true"
                        viewBox="0 0 18 18"
                      >
                        <path
                          fill="currentColor"
                          d="M15.6 3.3c-.4-.4-1-.4-1.4 0s-.4 1 0 1.4C15.4 5.9 16 7.4 16 9s-.6 3.1-1.8 4.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.3 0 .5-.1.7-.3C17.1 13.2 18 11.2 18 9s-.9-4.2-2.4-5.7"
                        />
                        <path
                          fill="currentColor"
                          d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"
                        />
                      </svg>
                    )}
                  </Btn>
                ) : (
                  <MuteButton
                    render={(p) => (
                      <Btn {...p} className="media-button--icon media-button--mute">
                        <OdyseeVolumeMuted
                          className="media-icon media-icon--volume-off"
                          size={18}
                          color="currentColor"
                        />
                        <svg
                          className="media-icon media-icon--volume-high"
                          xmlns="http://www.w3.org/2000/svg"
                          width={18}
                          height={18}
                          fill="none"
                          aria-hidden="true"
                          viewBox="0 0 18 18"
                        >
                          <path
                            fill="currentColor"
                            d="M15.6 3.3c-.4-.4-1-.4-1.4 0s-.4 1 0 1.4C15.4 5.9 16 7.4 16 9s-.6 3.1-1.8 4.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.3 0 .5-.1.7-.3C17.1 13.2 18 11.2 18 9s-.9-4.2-2.4-5.7"
                          />
                          <path
                            fill="currentColor"
                            d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"
                          />
                        </svg>
                      </Btn>
                    )}
                  />
                )}
                {isCasting && castState ? (
                  <span className="media-time">
                    <span className="media-time__value">{formatCastTime(castState.currentTime)}</span>
                    <span className="media-time__separator">/</span>
                    <span className="media-time__value">{formatCastTime(castState.duration)}</span>
                  </span>
                ) : isLivestream ? (
                  <LiveButton />
                ) : (
                  <Time.Group className="media-time" onClick={() => setShowRemaining((v) => !v)}>
                    <Time.Value type={showRemaining ? 'remaining' : 'current'} className="media-time__value" />
                    <Time.Separator className="media-time__separator" />
                    <Time.Value type="duration" className="media-time__value" />
                  </Time.Group>
                )}
              </div>

              <div
                className={classnames(
                  'media-surface',
                  MOBILE_CONTROL_LAYOUT_CLASSES.capsule,
                  MOBILE_CONTROL_LAYOUT_CLASSES.fullscreen
                )}
              >
                {isEmbeddedPlayback && (
                  <Popover.Root side="top" open={settingsOpen} onOpenChange={(open) => setSettingsOpen(open)}>
                    <Popover.Trigger
                      render={
                        <button
                          type="button"
                          className={classnames(
                            'media-button media-button--icon',
                            PLAYER_BUTTON_CLASSES.settings,
                            settingsOpen && PLAYER_BUTTON_CLASSES.settingsOpen
                          )}
                          aria-label={__('Settings')}
                        >
                          <OdyseeSettings
                            className={classnames('media-icon', PLAYER_BUTTON_CLASSES.settingsIcon)}
                            size={18}
                            color="currentColor"
                          />
                          {(quality.isHD || (quality.levels.length === 0 && (originalVideoHeight || 0) >= 720)) && (
                            <span className={PLAYER_BUTTON_CLASSES.hdBadge}>HD</span>
                          )}
                        </button>
                      }
                    />
                    <Popover.Popup className={settingsPopoverClassName}>
                      <SettingsMenuContent
                        isMarkdownOrComment={isMarkdownOrComment}
                        isLivestream={Boolean(isLivestream)}
                        onToggleAutoplayNext={onToggleAutoplayNext}
                        autoplayNext={autoplayNext}
                        floatingPlayer={floatingPlayer}
                        onToggleFloatingPlayer={onToggleFloatingPlayer}
                        autoplayMedia={autoplayMedia}
                        onToggleAutoplayMedia={onToggleAutoplayMedia}
                        title={title}
                        onShowShortcuts={() => setShowShortcuts(true)}
                        onCloseMenu={() => setSettingsOpen(false)}
                        quality={quality}
                        isFloating={isFloating}
                        embedded={isEmbeddedPlayback}
                        externalEmbed={externalEmbed}
                        isCasting={isCasting}
                      />
                    </Popover.Popup>
                  </Popover.Root>
                )}
                {castAvailable && onCastToggle && (
                  <Btn
                    className={classnames(
                      'media-button--icon',
                      PLAYER_BUTTON_CLASSES.cast,
                      isCasting && PLAYER_BUTTON_CLASSES.castActive
                    )}
                    aria-label={isCasting ? 'Stop casting' : 'Cast'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCastToggle();
                    }}
                  >
                    <svg
                      className="media-icon"
                      xmlns="http://www.w3.org/2000/svg"
                      width={19}
                      height={19}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M2 8v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
                      <path d="M2 16a5 5 0 0 1 5 5M2 12a9 9 0 0 1 9 9" />
                      <circle cx={2} cy={20} r={1.5} fill="#fff" stroke="none" />
                    </svg>
                  </Btn>
                )}
                <Btn
                  type="button"
                  className="media-button--icon media-button--fullscreen"
                  aria-label="Fullscreen"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (getFullscreenElement()) {
                      exitFullscreen();
                    } else {
                      const target = isEmbeddedPlayback
                        ? e.currentTarget.closest('.video-js-parent')
                        : e.currentTarget.closest('.player-fullscreen-target');
                      if (target) requestFullscreen(target);
                    }
                  }}
                >
                  <svg
                    ref={fsEnterIconRef}
                    className="media-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    width={18}
                    height={18}
                    fill="none"
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  <svg
                    ref={fsExitIconRef}
                    className="media-icon"
                    style={{ display: 'none' }}
                    xmlns="http://www.w3.org/2000/svg"
                    width={18}
                    height={18}
                    fill="none"
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 14h6v6m10-10h-6V4M14 10l7-7M3 21l7-7" />
                  </svg>
                </Btn>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={CONTROL_LAYOUT_CLASSES.leftGroup}>
              <div
                className={classnames(
                  'media-surface odysee-controls',
                  CONTROL_LAYOUT_CLASSES.side,
                  CONTROL_LAYOUT_CLASSES.left
                )}
              >
                {!isMarkdownOrComment && canPlayPrevious && onPlayPrevious && (
                  <Tooltip.Root side="top">
                    <Tooltip.Trigger
                      render={
                        <button type="button" className="media-button media-button--icon" onClick={onPlayPrevious}>
                          <OdyseePlayPrevious className="media-icon" size={18} color="currentColor" />
                        </button>
                      }
                    />
                    <Tooltip.Popup className="media-tooltip">{__('Play Previous (SHIFT+P)')}</Tooltip.Popup>
                  </Tooltip.Root>
                )}

                {isCasting && castState ? (
                  castState.playerState !== 'PLAYING' && castState.playerState !== 'PAUSED' ? (
                    <Btn className="media-button--icon media-button--play">
                      <div className={CAST_CLASSES.spinner} />
                    </Btn>
                  ) : (
                    <Tooltip.Root side="top">
                      <Tooltip.Trigger
                        render={
                          <Btn className="media-button--icon media-button--play" onClick={castTogglePlay}>
                            {castState.isPaused ? (
                              <OdyseePlay className="media-icon" size={18} color="currentColor" />
                            ) : (
                              <svg
                                className="media-icon"
                                xmlns="http://www.w3.org/2000/svg"
                                width={18}
                                height={18}
                                fill="none"
                                aria-hidden="true"
                                viewBox="0 0 18 18"
                              >
                                <rect width={4} height={12} x={3} y={3} fill="currentColor" rx={1.75} />
                                <rect width={4} height={12} x={11} y={3} fill="currentColor" rx={1.75} />
                              </svg>
                            )}
                          </Btn>
                        }
                      />
                      <Tooltip.Popup className="media-tooltip">
                        {castState.isPaused ? __('Play (space)') : __('Pause (space)')}
                      </Tooltip.Popup>
                    </Tooltip.Root>
                  )
                ) : (
                  <Tooltip.Root side="top">
                    <Tooltip.Trigger
                      render={
                        <PlayButton
                          render={(p) => (
                            <Btn {...p} className="media-button--icon media-button--play">
                              <OdyseeReplay className="media-icon media-icon--restart" size={18} color="currentColor" />
                              <OdyseePlay className="media-icon media-icon--play" size={18} color="currentColor" />
                              <svg
                                className="media-icon media-icon--pause"
                                xmlns="http://www.w3.org/2000/svg"
                                width={18}
                                height={18}
                                fill="none"
                                aria-hidden="true"
                                viewBox="0 0 18 18"
                              >
                                <rect width={4} height={12} x={3} y={3} fill="currentColor" rx={1.75} />
                                <rect width={4} height={12} x={11} y={3} fill="currentColor" rx={1.75} />
                              </svg>
                            </Btn>
                          )}
                        />
                      }
                    />
                    <Tooltip.Popup className="media-tooltip">
                      <PlayLabel />
                    </Tooltip.Popup>
                  </Tooltip.Root>
                )}

                {!isMarkdownOrComment && canPlayNext && onPlayNext && (
                  <Tooltip.Root side="top">
                    <Tooltip.Trigger
                      render={
                        <button
                          type="button"
                          className="media-button media-button--icon"
                          onClick={() => onPlayNext({ manual: true })}
                        >
                          <OdyseePlayPrevious
                            className="media-icon"
                            size={18}
                            color="currentColor"
                            style={{ transform: 'scaleX(-1)' }}
                          />
                        </button>
                      }
                    />
                    <Tooltip.Popup className="media-tooltip">{__('Play Next (SHIFT+N)')}</Tooltip.Popup>
                  </Tooltip.Root>
                )}

                <div className={VOLUME_CONTROL_CLASSES.group}>
                  {isCasting && castState ? (
                    <Btn
                      className="media-button--icon media-button--mute"
                      onClick={() => castActions && castActions.toggleMute()}
                    >
                      {castState.isMuted ? (
                        <OdyseeVolumeMuted className="media-icon" size={18} color="currentColor" />
                      ) : (
                        <svg
                          className="media-icon"
                          xmlns="http://www.w3.org/2000/svg"
                          width={18}
                          height={18}
                          fill="none"
                          aria-hidden="true"
                          viewBox="0 0 18 18"
                        >
                          <path
                            fill="currentColor"
                            d="M15.6 3.3c-.4-.4-1-.4-1.4 0s-.4 1 0 1.4C15.4 5.9 16 7.4 16 9s-.6 3.1-1.8 4.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.3 0 .5-.1.7-.3C17.1 13.2 18 11.2 18 9s-.9-4.2-2.4-5.7"
                          />
                          <path
                            fill="currentColor"
                            d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"
                          />
                        </svg>
                      )}
                    </Btn>
                  ) : (
                    <MuteButton
                      render={(p) => (
                        <Btn {...p} className="media-button--icon media-button--mute">
                          <OdyseeVolumeMuted
                            className="media-icon media-icon--volume-off"
                            size={18}
                            color="currentColor"
                          />
                          <svg
                            className="media-icon media-icon--volume-low"
                            xmlns="http://www.w3.org/2000/svg"
                            width={18}
                            height={18}
                            fill="none"
                            aria-hidden="true"
                            viewBox="0 0 18 18"
                          >
                            <path
                              fill="currentColor"
                              d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"
                            />
                          </svg>
                          <svg
                            className="media-icon media-icon--volume-high"
                            xmlns="http://www.w3.org/2000/svg"
                            width={18}
                            height={18}
                            fill="none"
                            aria-hidden="true"
                            viewBox="0 0 18 18"
                          >
                            <path
                              fill="currentColor"
                              d="M15.6 3.3c-.4-.4-1-.4-1.4 0s-.4 1 0 1.4C15.4 5.9 16 7.4 16 9s-.6 3.1-1.8 4.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.3 0 .5-.1.7-.3C17.1 13.2 18 11.2 18 9s-.9-4.2-2.4-5.7"
                            />
                            <path
                              fill="currentColor"
                              d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"
                            />
                          </svg>
                        </Btn>
                      )}
                    />
                  )}
                  {!isShorts &&
                    (isCasting && castState ? (
                      <CastVolumeSlider castState={castState} castActions={castActions} />
                    ) : (
                      <VolumeSlider.Root
                        className={classnames('media-slider', VOLUME_CONTROL_CLASSES.slider)}
                        orientation="horizontal"
                        thumbAlignment="edge"
                      >
                        <Slider.Track className="media-slider__track">
                          <Slider.Fill className="media-slider__fill" />
                        </Slider.Track>
                        <Slider.Thumb className="media-slider__thumb" />
                      </VolumeSlider.Root>
                    ))}
                </div>

                {isCasting && castState ? (
                  <span className="media-time">
                    <span className="media-time__value">{formatCastTime(castState.currentTime)}</span>
                    <span className="media-time__separator">/</span>
                    <span className="media-time__value">{formatCastTime(castState.duration)}</span>
                  </span>
                ) : isLivestream ? (
                  <LiveButton />
                ) : (
                  <Time.Group className="media-time" onClick={() => setShowRemaining((v) => !v)}>
                    <Time.Value type={showRemaining ? 'remaining' : 'current'} className="media-time__value" />
                    <Time.Separator className="media-time__separator" />
                    <Time.Value type="duration" className="media-time__value" />
                  </Time.Group>
                )}
              </div>

              {chapters.length > 0 && !isFloating && !isEmbeddedPlayback && <ChapterPill chapters={chapters} />}
            </div>

            <div className={classnames('media-surface odysee-controls', CONTROL_LAYOUT_CLASSES.side)}>
              <Tooltip.Root side="top">
                <Tooltip.Trigger
                  render={
                    <CaptionsButton
                      render={(p) => (
                        <Btn {...p} className="media-button--icon media-button--captions">
                          <svg
                            className="media-icon media-icon--captions-off"
                            xmlns="http://www.w3.org/2000/svg"
                            width={18}
                            height={18}
                            fill="none"
                            aria-hidden="true"
                            viewBox="0 0 18 18"
                          >
                            <rect
                              width={16.5}
                              height={12.5}
                              x={0.75}
                              y={2.75}
                              stroke="currentColor"
                              strokeWidth={1.5}
                              rx={3}
                            />
                            <rect width={3} height={1.5} x={3} y={8.5} fill="currentColor" rx={0.75} />
                            <rect width={2} height={1.5} x={13} y={8.5} fill="currentColor" rx={0.75} />
                            <rect width={4} height={1.5} x={11} y={11.5} fill="currentColor" rx={0.75} />
                            <rect width={5} height={1.5} x={7} y={8.5} fill="currentColor" rx={0.75} />
                            <rect width={7} height={1.5} x={3} y={11.5} fill="currentColor" rx={0.75} />
                          </svg>
                          <svg
                            className="media-icon media-icon--captions-on"
                            xmlns="http://www.w3.org/2000/svg"
                            width={18}
                            height={18}
                            fill="none"
                            aria-hidden="true"
                            viewBox="0 0 18 18"
                          >
                            <path
                              fill="currentColor"
                              d="M15 2a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM3.75 11.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5zm8 0a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5zm-8-3a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5zm4 0a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5zm6 0a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5z"
                            />
                          </svg>
                        </Btn>
                      )}
                    />
                  }
                />
                <Tooltip.Popup className="media-tooltip">
                  <CaptionsLabel />
                </Tooltip.Popup>
              </Tooltip.Root>

              {isLivestream && (
                <P2PControl
                  isLivestream={Boolean(isLivestream)}
                  p2pEnabled={p2pEnabled}
                  p2pUiState={p2pUiState}
                  onToggle={() => dispatch(doSetClientSetting(SETTINGS.P2P_DELIVERY, !p2pEnabled))}
                />
              )}

              <Popover.Root side="top" open={settingsOpen} onOpenChange={(open) => setSettingsOpen(open)}>
                <Popover.Trigger
                  render={
                    <button
                      type="button"
                      className={classnames(
                        'media-button media-button--icon',
                        PLAYER_BUTTON_CLASSES.settings,
                        settingsOpen && PLAYER_BUTTON_CLASSES.settingsOpen
                      )}
                      aria-label={__('Settings')}
                    >
                      <OdyseeSettings
                        className={classnames('media-icon', PLAYER_BUTTON_CLASSES.settingsIcon)}
                        size={18}
                        color="currentColor"
                      />
                      {(quality.isHD || (quality.levels.length === 0 && (originalVideoHeight || 0) >= 720)) && (
                        <span className={PLAYER_BUTTON_CLASSES.hdBadge}>HD</span>
                      )}
                    </button>
                  }
                />
                <Popover.Popup className={settingsPopoverClassName}>
                  <SettingsMenuContent
                    isMarkdownOrComment={isMarkdownOrComment}
                    isLivestream={Boolean(isLivestream)}
                    onToggleAutoplayNext={onToggleAutoplayNext}
                    autoplayNext={autoplayNext}
                    floatingPlayer={floatingPlayer}
                    onToggleFloatingPlayer={onToggleFloatingPlayer}
                    autoplayMedia={autoplayMedia}
                    onToggleAutoplayMedia={onToggleAutoplayMedia}
                    title={title}
                    onShowShortcuts={() => setShowShortcuts(true)}
                    onCloseMenu={() => setSettingsOpen(false)}
                    quality={quality}
                    isFloating={isFloating}
                    embedded={isEmbeddedPlayback}
                    externalEmbed={externalEmbed}
                    isCasting={isCasting}
                  />
                </Popover.Popup>
              </Popover.Root>

              {castAvailable && onCastToggle && (
                <Tooltip.Root side="top">
                  <Tooltip.Trigger
                    render={
                      <Btn
                        className={classnames(
                          'media-button--icon',
                          PLAYER_BUTTON_CLASSES.cast,
                          isCasting && PLAYER_BUTTON_CLASSES.castActive
                        )}
                        aria-label={isCasting ? 'Stop casting' : 'Cast'}
                        onClick={onCastToggle}
                      >
                        <svg
                          className="media-icon"
                          xmlns="http://www.w3.org/2000/svg"
                          width={19}
                          height={19}
                          fill="none"
                          stroke="#fff"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="M2 8v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
                          <path d="M2 16a5 5 0 0 1 5 5M2 12a9 9 0 0 1 9 9" />
                          <circle cx={2} cy={20} r={1.5} fill="#fff" stroke="none" />
                        </svg>
                      </Btn>
                    }
                  />
                  <Tooltip.Popup className="media-tooltip">{isCasting ? __('Stop Casting') : __('Cast')}</Tooltip.Popup>
                </Tooltip.Root>
              )}

              {!isMobileDevice &&
                !isEmbeddedPlayback &&
                !isFloating &&
                !isMarkdownOrComment &&
                typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function' && (
                  <Tooltip.Root side="top">
                    <Tooltip.Trigger
                      render={
                        <Btn
                          className="media-button--icon"
                          aria-label="Picture-in-Picture"
                          onClick={() => {
                            const video =
                              media instanceof HTMLVideoElement
                                ? media
                                : (media as Element | null)?.querySelector?.('video') ||
                                  document.querySelector('video');
                            if (!video) return;
                            if (document.pictureInPictureElement) {
                              document.exitPictureInPicture().catch(() => {});
                            } else {
                              video.disablePictureInPicture = false;
                              video.requestPictureInPicture().catch(() => {});
                            }
                          }}
                        >
                          <svg
                            className="media-icon"
                            xmlns="http://www.w3.org/2000/svg"
                            width={19}
                            height={19}
                            fill="none"
                            stroke="#fff"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
                            <rect x="12" y="11" width="8" height="8" rx="1" fill="#fff" stroke="none" />
                          </svg>
                        </Btn>
                      }
                    />
                    <Tooltip.Popup className="media-tooltip">{__('Picture-in-Picture')}</Tooltip.Popup>
                  </Tooltip.Root>
                )}

              {!isMarkdownOrComment && !isEmbeddedPlayback && !isFloating && onToggleTheaterMode && (
                <Tooltip.Root side="top">
                  <Tooltip.Trigger
                    render={
                      <button
                        type="button"
                        className={classnames('media-button media-button--icon', PLAYER_BUTTON_CLASSES.theaterButton)}
                        onClick={onToggleTheaterMode}
                      >
                        <OdyseeTheater active={videoTheaterMode} />
                      </button>
                    }
                  />
                  <Tooltip.Popup className="media-tooltip">
                    {videoTheaterMode ? __('Default Mode (t)') : __('Theater Mode (t)')}
                  </Tooltip.Popup>
                </Tooltip.Root>
              )}

              <Tooltip.Root side="top">
                <Tooltip.Trigger
                  render={
                    <Btn
                      type="button"
                      className="media-button--icon media-button--fullscreen"
                      aria-label="Fullscreen"
                      onClick={(e) => {
                        if (getFullscreenElement()) {
                          exitFullscreen();
                        } else {
                          const target = e.currentTarget.closest(
                            isEmbeddedPlayback ? '.video-js-parent' : '.player-fullscreen-target'
                          );
                          if (target) requestFullscreen(target);
                        }
                      }}
                    >
                      <svg
                        ref={fsEnterIconRef}
                        className="media-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width={18}
                        height={18}
                        fill="none"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                      </svg>
                      <svg
                        ref={fsExitIconRef}
                        className="media-icon"
                        style={{ display: 'none' }}
                        xmlns="http://www.w3.org/2000/svg"
                        width={18}
                        height={18}
                        fill="none"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 14h6v6m10-10h-6V4M14 10l7-7M3 21l7-7" />
                      </svg>
                    </Btn>
                  }
                />
                <Tooltip.Popup className="media-tooltip">{__('Fullscreen (f)')}</Tooltip.Popup>
              </Tooltip.Root>
            </div>
          </>
        )}
      </Controls.Root>

      {!isEmbeddedPlayback && (
        <div className={classnames('media-overlay', hasMobileControls && PLAYER_SKIN_CLASSES.mobileOverlay)} />
      )}

      {isEmbeddedPlayback && (
        <div className={classnames(EMBED_HEADER_CLASSES.root, isOdyseeEmbeddedPlayback && EMBED_HEADER_CLASSES.odysee)}>
          {!isOdyseeEmbeddedPlayback && (
            <a
              className={EMBED_HEADER_CLASSES.title}
              href={uri ? URL + formatLbryUrlForWeb(uri) : URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {title}
            </a>
          )}
          <a className={EMBED_HEADER_CLASSES.logo} href={URL} target="_blank" rel="noopener noreferrer">
            <Logo type="embed" />
          </a>
        </div>
      )}

      <SeekIndicator />

      {showShortcuts && <KeyboardShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={CONTEXT_MENU_CLASSES.root}
          data-odysee-context-menu
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxToggleLoop}>
            <OdyseeRepeat className={CONTEXT_MENU_CLASSES.icon} size={14} color="currentColor" />
            <span className={CONTEXT_MENU_CLASSES.label}>{__('Loop')}</span>
            {looped && <span className={CONTEXT_MENU_CLASSES.check}>✓</span>}
          </button>
          {pipSupported && !isMobileDevice && (
            <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxTogglePip}>
              <svg
                className={CONTEXT_MENU_CLASSES.icon}
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <rect x="13" y="10" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
              </svg>
              <span className={CONTEXT_MENU_CLASSES.label}>{__('Miniplayer')}</span>
            </button>
          )}
          {castAvailable && onCastToggle && (
            <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxCast}>
              <OdyseeCast width={14} height={14} />
              <span className={CONTEXT_MENU_CLASSES.label}>{isCasting ? __('Stop casting') : __('Cast')}</span>
            </button>
          )}
          {!isExternalEmbedPlayback && (onToggleAutoplayMedia || (onToggleAutoplayNext && !isShorts)) && (
            <div className={CONTEXT_MENU_CLASSES.separator} />
          )}
          {!isExternalEmbedPlayback && onToggleAutoplayMedia && (
            <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxToggleAutoplay}>
              <svg
                className={CONTEXT_MENU_CLASSES.icon}
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
              </svg>
              <span className={CONTEXT_MENU_CLASSES.label}>{__('Autoplay')}</span>
              {ctxAutoplayMedia && <span className={CONTEXT_MENU_CLASSES.check}>✓</span>}
            </button>
          )}
          {!isExternalEmbedPlayback && !isMarkdownOrComment && onToggleAutoplayNext && !isShorts && (
            <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxToggleAutoplayNext}>
              <OdyseeAutoplayNext className={CONTEXT_MENU_CLASSES.icon} size={14} />
              <span className={CONTEXT_MENU_CLASSES.label}>{__('Autoplay Next')}</span>
              {ctxAutoplayNext && <span className={CONTEXT_MENU_CLASSES.check}>✓</span>}
            </button>
          )}
          <div className={CONTEXT_MENU_CLASSES.separator} />
          <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxCopyUrl} disabled={!uri}>
            <OdyseeCopyLink className={CONTEXT_MENU_CLASSES.icon} size={14} color="currentColor" />
            <span className={CONTEXT_MENU_CLASSES.label}>{__('Copy video URL')}</span>
          </button>
          <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxCopyUrlAtTime} disabled={!uri}>
            <OdyseeTime className={CONTEXT_MENU_CLASSES.icon} size={14} />
            <span className={CONTEXT_MENU_CLASSES.label}>{__('Copy video URL at current time')}</span>
          </button>
          <button type="button" className={CONTEXT_MENU_CLASSES.item} onClick={ctxCopyEmbed} disabled={!uri}>
            <OdyseeEmbed className={CONTEXT_MENU_CLASSES.icon} size={14} color="currentColor" />
            <span className={CONTEXT_MENU_CLASSES.label}>{__('Copy embed code')}</span>
          </button>
        </div>
      )}
    </Player.Container>
  );
}
