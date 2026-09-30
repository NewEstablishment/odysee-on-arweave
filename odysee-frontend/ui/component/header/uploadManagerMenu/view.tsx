import React from 'react';
import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import Icon from 'component/common/icon';
import Button from 'component/button';
import Tooltip from 'component/common/tooltip';
import { Menu as MuiMenu } from '@mui/material';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import { NavLink, useNavigate } from 'react-router-dom';
import { formatLbryUrlForWeb } from 'util/url';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectActivePipelineItems, selectPublishFormValue } from 'redux/selectors/publish';
import { doRemovePipelineItem, doUpdatePipelineItem } from 'redux/actions/publishPipeline';
import { dequeue } from 'util/pipeline-queue';
import { doSwitchPublishForm } from 'redux/actions/publish';
import type { PipelineItem } from 'redux/actions/publishPipeline';
import { NOTIFICATION_BUBBLE_CLASSES } from 'component/notificationBubble/classes';
import { HEADER_NAVIGATION_ICON_CLASS } from 'component/header/classes';
import { UPLOAD_MANAGER_CLASSES } from './classes';
import { MENU_CLASSES } from 'component/common/menu-classes';

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  converting: 'Converting',
  optimizing: 'Optimizing',
  uploading: 'Uploading',
  ready: 'Ready to publish',
  processing: 'Processing',
  pausing: 'Pausing',
  published: 'Published',
  paused: 'Paused',
  error: 'Error',
};

const STEP_LABELS: Record<string, string> = {
  converting: 'Convert',
  optimizing: 'Optimize',
  uploading: 'Upload',
  processing: 'Publish',
};

const formatPipelineProgress = (progress: number) => {
  const rounded = Math.max(0, Math.min(100, progress));
  return String(Math.round(rounded));
};

const formatSpeed = (bytesPerSecond: number) => {
  if (bytesPerSecond >= 1e9) return `${(bytesPerSecond / 1e9).toFixed(1)} GB/s`;
  if (bytesPerSecond >= 1e6) return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1e3) return `${(bytesPerSecond / 1e3).toFixed(0)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
};

type Props = {
  hasActivity: boolean;
  onUploadClick: () => void;
};

export default function UploadManagerMenu(props: Props) {
  const { hasActivity, onUploadClick } = props;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const pipelineItems = useAppSelector(selectActivePipelineItems) as PipelineItem[];
  const uploadEntries: any[] = [];
  const activeFormId = useAppSelector((state) => selectPublishFormValue(state, 'activeFormId'));

  function handleEntryClick(itemId: string, step?: number) {
    dispatch({ type: 'PUBLISH_SET_ACTIVE_FORM', data: { id: itemId } });
    if (step !== undefined) {
      dispatch({ type: 'PUBLISH_SAVE_STEP', data: { formId: itemId, activeStep: step } });
    }
    navigate(`/$/${PAGES.UPLOAD}`);
    handleClose();
  }

  const [anchorEl, setAnchorEl] = React.useState(null);
  const [clicked, setClicked] = React.useState(false);
  const open = Boolean(anchorEl);

  const handleClick = (event) => {
    if (hasActivity) {
      setAnchorEl(!anchorEl ? event.currentTarget : null);
    } else {
      onUploadClick();
    }
  };

  const handleClose = () => setAnchorEl(null);

  const handleClickAway = () => {
    if (!clicked) {
      if (open) setClicked(true);
    } else {
      setAnchorEl(null);
      setClicked(false);
    }
  };

  React.useEffect(() => {
    if (!open) setClicked(false);
  }, [open]);

  const menuProps = {
    id: 'upload-manager-menu',
    anchorEl,
    open,
    onClose: handleClose,
    MenuListProps: {
      'aria-labelledby': 'upload-manager-button',
      sx: { padding: 0 },
    },
    className: `${MENU_CLASSES.header} menu__list--upload-manager`,
    anchorOrigin: { vertical: 'bottom' as const, horizontal: 'center' as const },
    transformOrigin: { vertical: 'top' as const, horizontal: 'center' as const },
    sx: { 'z-index': 2 },
    PaperProps: { className: MENU_CLASSES.paper },
    disableScrollLock: true,
  };

  function renderPipelineEntry(item: PipelineItem) {
    return (
      <div
        className={UPLOAD_MANAGER_CLASSES.entry}
        key={item.id}
        onClick={() => {
          if (item.stage === 'published' && item.uri) {
            navigate(formatLbryUrlForWeb(item.uri));
            handleClose();
          } else {
            handleEntryClick(item.formId || item.id);
          }
        }}
      >
        <div
          className={`${UPLOAD_MANAGER_CLASSES.icon}${item.stage === 'ready' ? ` ${UPLOAD_MANAGER_CLASSES.iconReady}` : ''}`}
        >
          <Icon
            sectionIcon
            icon={(() => {
              const s = item.stage === 'paused' || item.stage === 'pausing' ? item.previousStage : item.stage;
              return item.stage === 'published'
                ? ICONS.COMPLETED
                : s === 'queued'
                  ? ICONS.TIME
                  : s === 'converting'
                    ? ICONS.REFRESH
                    : s === 'optimizing'
                      ? ICONS.SETTINGS
                      : s === 'processing'
                        ? ICONS.REFRESH
                        : item.stage === 'error'
                          ? ICONS.ALERT
                          : ICONS.PUBLISH;
            })()}
          />
        </div>
        <div className="tw:min-w-0 tw:flex-1 tw:overflow-hidden">
          <div className="tw:flex tw:items-center tw:justify-between tw:gap-app-xs">
            <div className="tw:block tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text tw:group-hover/upload-manager-entry:text-app-primary">
              {item.filename}
            </div>
            {item.stage === 'uploading' && item.uploadSpeed ? (
              <span className="tw:mr-app-xs tw:font-normal tw:text-[rgba(var(--color-text-base),0.5)]">
                {formatSpeed(item.uploadSpeed)}
              </span>
            ) : null}
          </div>
          {(() => {
            const displaySteps = [...(item.steps || ['uploading']), 'processing'];
            const activeStage = item.stage === 'paused' || item.stage === 'pausing' ? item.previousStage : item.stage;
            const stepIndex = displaySteps.indexOf(activeStage);
            const allDone = item.stage === 'published';
            const isReady = item.stage === 'ready';
            return (
              <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.6)]">
                <div className="tw:flex tw:items-center tw:gap-app-xxs tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.4)]">
                  {displaySteps.map((step, i) => {
                    const isDone = allDone || (isReady && step !== 'processing') || (stepIndex >= 0 && i < stepIndex);
                    const isActive = (!allDone && !isReady && i === stepIndex) || (isReady && step === 'processing');
                    return (
                      <React.Fragment key={step}>
                        {i > 0 && <span className="tw:shrink-0 tw:text-[rgba(var(--color-text-base),0.3)]">›</span>}
                        <span
                          className={`tw:whitespace-nowrap${
                            isDone ? ' tw:text-[rgba(var(--color-text-base),0.6)] tw:line-through' : ''
                          }${isActive ? ' tw:font-semibold tw:text-app-text' : ''}`}
                        >
                          {__(STEP_LABELS[step] || step)}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
                {item.stage === 'ready' ? (
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-[var(--color-notification)]">
                    {__('Action required')}
                  </span>
                ) : (
                  item.stage !== 'error' &&
                  item.stage !== 'published' &&
                  item.stage !== 'queued' && (
                    <span className="tw:font-semibold tw:[font-variant-numeric:tabular-nums]">
                      {formatPipelineProgress(item.progress)}%
                    </span>
                  )
                )}
              </div>
            );
          })()}
          {item.stage !== 'error' && item.stage !== 'published' && (
            <div className="tw:mt-app-xxs tw:h-[3px] tw:overflow-hidden tw:rounded-[2px] tw:bg-app-border">
              <div
                className="tw:h-full tw:rounded-[2px] tw:[background-image:var(--color-odysee-gradient)] tw:[transition:width_0.3s_ease]"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="tw:ml-app-xs tw:flex tw:shrink-0 tw:items-center">
          {item.stage !== 'error' &&
            item.stage !== 'published' &&
            item.stage !== 'paused' &&
            item.stage !== 'pausing' &&
            item.stage !== 'queued' &&
            item.stage !== 'processing' &&
            item.stage !== 'ready' && (
              <button
                className={UPLOAD_MANAGER_CLASSES.actionButton}
                onClick={async (e) => {
                  e.stopPropagation();
                  const stage = item.stage;
                  dispatch(doUpdatePipelineItem(item.id, { previousStage: stage, stage: 'pausing' }));
                  if (stage === 'uploading') {
                    (window as any).__earlyUploadHandles?.[item.id]?.pause();
                    dispatch(doUpdatePipelineItem(item.id, { previousStage: stage, stage: 'paused' }));
                  } else {
                    const ph = (window as any).__pipelineHandles?.[item.id];
                    await ph?.handleRef?.current?.pause?.();
                    ph?.pause?.();
                    dispatch(
                      doUpdatePipelineItem(item.id, { previousStage: item.previousStage || stage, stage: 'paused' })
                    );
                  }
                }}
                title={__('Pause')}
              >
                <span className={UPLOAD_MANAGER_CLASSES.pauseIcon} />
              </button>
            )}
          {item.stage === 'pausing' && (
            <button className={UPLOAD_MANAGER_CLASSES.actionButton} disabled title={__('Pausing')}>
              <span className={UPLOAD_MANAGER_CLASSES.pauseIcon} />
            </button>
          )}
          {item.stage === 'paused' && (
            <button
              className={UPLOAD_MANAGER_CLASSES.actionButton}
              onClick={(e) => {
                e.stopPropagation();
                if (item.previousStage === 'uploading') {
                  (window as any).__earlyUploadHandles?.[item.id]?.resume();
                } else {
                  const ph = (window as any).__pipelineHandles?.[item.id];
                  ph?.handleRef?.current?.resume?.();
                  ph?.resume?.();
                }
                dispatch(doUpdatePipelineItem(item.id, { stage: item.previousStage || 'converting' }));
              }}
              title={__('Resume')}
            >
              <Icon icon={ICONS.PLAY} size={14} />
            </button>
          )}
          {(item.stage === 'error' || item.stage === 'queued' || item.stage === 'published') && (
            <button
              className={UPLOAD_MANAGER_CLASSES.actionButton}
              onClick={(e) => {
                e.stopPropagation();
                if (item.stage === 'queued') dequeue(item.id);
                dispatch(doRemovePipelineItem(item.id));
              }}
              title={item.stage === 'published' ? __('Dismiss') : __('Remove')}
            >
              <Icon icon={ICONS.REMOVE} size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderUploadEntry(upload: any) {
    return (
      <div className={UPLOAD_MANAGER_CLASSES.entry} key={upload.params?.guid}>
        <div className={UPLOAD_MANAGER_CLASSES.icon}>
          <Icon icon={ICONS.PUBLISH} sectionIcon />
        </div>
        <div className="tw:min-w-0 tw:flex-1 tw:overflow-hidden">
          <div className="tw:block tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text tw:group-hover/upload-manager-entry:text-app-primary">
            {upload.params?.name || __('Uploading...')}
          </div>
          <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.6)]">
            {upload.status === 'error' ? __('Error') : __('Uploading %progress%%', { progress: upload.progress || 0 })}
          </div>
        </div>
      </div>
    );
  }

  const overallProgress = React.useMemo(() => {
    const items: number[] = [];
    pipelineItems.forEach((item) => {
      if (item.stage !== 'error' && item.stage !== 'published') {
        items.push(item.progress);
      }
    });
    uploadEntries.forEach((upload: any) => {
      if (upload.status !== 'error') {
        items.push(upload.progress || 0);
      }
    });
    if (items.length === 0) return 0;
    return Math.round(items.reduce((a, b) => a + b, 0) / items.length);
  }, [pipelineItems, uploadEntries]);

  const progressSnapshotsRef = React.useRef<Map<string, { time: number; progress: number }>>(new Map());

  const remainingTime = React.useMemo(() => {
    const now = Date.now();
    const snapshots = progressSnapshotsRef.current;
    let totalSecondsLeft = 0;
    let hasEstimate = false;

    pipelineItems.forEach((item) => {
      if (item.stage === 'error' || item.stage === 'published') {
        snapshots.delete(item.id);
        return;
      }

      if (item.stage === 'paused' || item.stage === 'pausing' || item.stage === 'ready' || item.stage === 'queued') {
        snapshots.delete(item.id);
        return;
      }

      if (item.stage === 'uploading' && item.uploadSpeed && item.uploadSpeed > 0 && item.fileSize) {
        const remainingBytes = item.fileSize * (1 - item.progress / 100);
        totalSecondsLeft += remainingBytes / item.uploadSpeed;
        hasEstimate = true;
        snapshots.set(item.id, { time: now, progress: item.progress });
        return;
      }

      const snap = snapshots.get(item.id);
      if (!snap || snap.progress > item.progress) {
        snapshots.set(item.id, { time: now, progress: item.progress });
        return;
      }
      const elapsed = (now - snap.time) / 1000;
      const delta = item.progress - snap.progress;
      if (elapsed >= 2 && delta >= 1) {
        const rate = delta / elapsed;
        totalSecondsLeft += (100 - item.progress) / rate;
        hasEstimate = true;
      }
    });

    uploadEntries.forEach((upload: any) => {
      if (upload.status === 'error') return;
      const id = `upload-${upload.params?.guid}`;
      const snap = snapshots.get(id);
      const progress = upload.progress || 0;
      if (!snap || snap.progress > progress) {
        snapshots.set(id, { time: now, progress });
        return;
      }
      const elapsed = (now - snap.time) / 1000;
      const delta = progress - snap.progress;
      if (elapsed >= 2 && delta >= 1) {
        const rate = delta / elapsed;
        totalSecondsLeft += (100 - progress) / rate;
        hasEstimate = true;
      }
    });

    if (!hasEstimate) return null;
    const s = Math.round(totalSecondsLeft);
    if (s < 60) return __('%seconds%s left', { seconds: s });
    if (s < 3600) return __('%minutes%m left', { minutes: Math.round(s / 60) });
    return __('%hours%h %minutes%m left', { hours: Math.floor(s / 3600), minutes: Math.round((s % 3600) / 60) });
  }, [pipelineItems, uploadEntries]);

  const allComplete =
    pipelineItems.length > 0 && pipelineItems.every((item) => item.stage === 'published' || item.stage === 'error');

  const [pulsing, setPulsing] = React.useState(false);
  const pulseSeenRef = React.useRef(false);

  React.useEffect(() => {
    if (allComplete && !pulseSeenRef.current) {
      setPulsing(true);
    }
    if (!allComplete) {
      pulseSeenRef.current = false;
      setPulsing(false);
    }
  }, [allComplete]);

  React.useEffect(() => {
    if (open && pulsing) {
      setPulsing(false);
      pulseSeenRef.current = true;
    }
  }, [open, pulsing]);

  const readyCount = pipelineItems.filter((item) => item.stage === 'ready').length;

  const ringStroke = 8;
  const ringRadius = 50 - ringStroke / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (overallProgress / 100) * ringCircumference;

  return (
    <>
      <Tooltip title={hasActivity ? __('Upload Progress') : __('Upload')}>
        <Button
          id="upload-manager-button"
          className={`${HEADER_NAVIGATION_ICON_CLASS}${
            pulsing
              ? " tw:relative tw:after:absolute tw:after:inset-0 tw:after:rounded-[inherit] tw:after:content-[''] tw:after:[animation:upload-complete-pulse_3.5s_ease-in-out_infinite]"
              : ''
          }`}
          onClick={handleClick}
        >
          {hasActivity && overallProgress > 0 && (
            <svg
              className="tw:pointer-events-none tw:absolute tw:top-0 tw:left-0 tw:size-full tw:[transform:rotate(-90deg)]"
              viewBox="0 0 100 100"
            >
              <defs>
                <linearGradient id="upload-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--color-primary)" />
                  <stop offset="100%" stopColor="#f77937" />
                </linearGradient>
              </defs>
              <circle
                className="tw:fill-none tw:[stroke:url(#upload-ring-gradient)] tw:[stroke-width:8] tw:[stroke-linecap:round] tw:[transition:stroke-dashoffset_0.3s_ease]"
                cx="50"
                cy="50"
                r={ringRadius}
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
              />
            </svg>
          )}
          <Icon size={18} icon={ICONS.PUBLISH} aria-hidden />
          {readyCount > 0 && (
            <span className={NOTIFICATION_BUBBLE_CLASSES.base}>
              <span className={'notification__count' + (readyCount > 9 ? ` ${NOTIFICATION_BUBBLE_CLASSES.small}` : '')}>
                {readyCount}
              </span>
            </span>
          )}
        </Button>
      </Tooltip>

      {hasActivity && (
        <ClickAwayListener onClickAway={handleClickAway}>
          <MuiMenu {...menuProps}>
            {pipelineItems.length + uploadEntries.length > 1 &&
              (() => {
                let totalSpeed = 0;
                const stageCounts: Record<string, number> = {};
                pipelineItems.forEach((item) => {
                  if (
                    item.uploadSpeed &&
                    item.stage !== 'paused' &&
                    item.stage !== 'pausing' &&
                    item.stage !== 'ready' &&
                    item.stage !== 'queued'
                  )
                    totalSpeed += item.uploadSpeed;
                  const stage =
                    item.stage === 'paused' || item.stage === 'pausing' ? item.previousStage || item.stage : item.stage;
                  if (stage !== 'published' && stage !== 'error' && stage !== 'ready') {
                    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
                  }
                });
                if (uploadEntries.length > 0) {
                  stageCounts['uploading'] = (stageCounts['uploading'] || 0) + uploadEntries.length;
                }
                const summary = Object.entries(stageCounts)
                  .map(([stage, count]) =>
                    __('%count% %stage%', { count, stage: __(STAGE_LABELS[stage] || stage).toLowerCase() })
                  )
                  .join(', ');
                return (
                  <div className="tw:flex tw:items-center tw:justify-between tw:[border-bottom:1px_solid_rgba(var(--color-header-button-base),0.95)] tw:bg-[rgba(var(--color-header-background-base),1)] tw:px-app-s tw:py-app-xs tw:text-app-small tw:font-semibold tw:text-app-text">
                    <span>
                      {summary || __('%count% uploads', { count: pipelineItems.length + uploadEntries.length })}
                      {totalSpeed > 0 && (
                        <span className="tw:font-normal tw:[font-variant-numeric:tabular-nums] tw:text-[rgba(var(--color-text-base),0.5)]">
                          {' · '}
                          {formatSpeed(totalSpeed)}
                        </span>
                      )}
                      {remainingTime && (
                        <span className="tw:font-normal tw:[font-variant-numeric:tabular-nums] tw:text-[rgba(var(--color-text-base),0.5)]">
                          {' · '}
                          {remainingTime}
                        </span>
                      )}
                    </span>
                    <span className="tw:[font-variant-numeric:tabular-nums] tw:text-[rgba(var(--color-text-base),0.6)]">
                      {overallProgress}%
                    </span>
                  </div>
                );
              })()}
            <div className="tw:bg-[var(--color-header-background)]">
              {pipelineItems.map(renderPipelineEntry)}
              {uploadEntries.map(renderUploadEntry)}
            </div>

            <div
              className="tw:relative tw:[border-top:1px_solid_rgba(var(--color-header-button-base),0.95)] tw:bg-[rgba(var(--color-header-background-base),1)] tw:px-app-xs tw:py-app-s tw:text-center tw:text-app-text tw:hover:cursor-pointer tw:hover:text-app-primary"
              onClick={() => {
                dispatch({ type: 'PUBLISH_SET_ACTIVE_FORM', data: { id: '__new__' } });
                navigate(`/$/${PAGES.UPLOAD}`);
                handleClose();
              }}
            >
              {__('Upload More')}
            </div>
          </MuiMenu>
        </ClickAwayListener>
      )}
    </>
  );
}
