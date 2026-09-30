import React from 'react';
import { WEB_PUBLISH_SIZE_LIMIT_GB } from 'config';
import { useAppDispatch } from 'redux/hooks';
import { doToast } from 'redux/actions/notifications';
import { doUpdatePublishForm } from 'redux/actions/publish';
import { cacheOptimizedFile } from 'util/uploadCache';
import {
  publishStatusActionClassName,
  publishStatusCardClassName,
  publishStatusCheckboxClassName,
  publishStatusDescriptionClassName,
  publishStatusHeaderClassName,
  publishStatusIconClassName,
  publishStatusTextClassName,
  publishStatusTitleClassName,
  type PublishStatusVariant,
} from 'component/publish/shared/publishStatusCard/classes';

// Lazy-import mediabunny to keep it out of the main bundle
async function loadMediaBunny() {
  const mb = await import('odysee-media-usagi');
  return mb;
}

type Props = {
  file: File;
  fileBitrate: number; // bps
  fileSizeTooBig?: boolean;
  variant: PublishStatusVariant;
  onOptimized: (optimizedFile: File) => void;
  onSkip: () => void;
};

type AnalysisResult = {
  bitrateMbps: number;
  duration: number;
  width: number;
  height: number;
  recommendedAction: 'transcode' | 'none';
};

type OptimizeState = 'idle' | 'analyzing' | 'ready' | 'optimizing' | 'done' | 'error';

const optimizerLabelVariantClassNames: Record<PublishStatusVariant, string> = {
  error: 'tw:bg-[rgba(244,67,54,0.15)] tw:text-[#f44336]',
  mandatory: 'tw:bg-[rgba(255,180,0,0.15)] tw:text-[#f5a623]',
  recommended: 'tw:bg-[rgba(76,175,80,0.15)] tw:text-[#4caf50]',
};

function optimizerOptionClassName(selected: boolean, variant: PublishStatusVariant) {
  const stateClassName = selected
    ? variant === 'mandatory'
      ? 'tw:cursor-default tw:border-[#f5a623] tw:bg-[rgba(255,180,0,0.06)]'
      : 'tw:cursor-default tw:border-[#4caf50] tw:bg-[rgba(76,175,80,0.06)]'
    : variant === 'mandatory'
      ? 'tw:cursor-pointer tw:border-app-border tw:bg-[rgba(var(--color-header-button-base),0.04)] tw:hover:border-[rgba(255,180,0,0.5)]'
      : 'tw:cursor-pointer tw:border-app-border tw:bg-[rgba(var(--color-header-button-base),0.04)] tw:hover:border-[rgba(76,175,80,0.5)]';

  return `tw:mt-0 tw:flex tw:flex-1 tw:items-start tw:gap-app-xs tw:rounded-[8px] tw:border tw:p-app-s tw:[transition:border-color_0.15s_ease,background_0.15s_ease] ${stateClassName}`;
}

function optimizerRadioClassName(variant: PublishStatusVariant) {
  const colorClassName =
    variant === 'mandatory'
      ? 'tw:border-[rgba(255,180,0,0.4)] tw:hover:border-[#f5a623] tw:checked:border-[#f5a623] tw:checked:bg-[#f5a623]'
      : 'tw:border-[rgba(76,175,80,0.4)] tw:hover:border-[#4caf50] tw:checked:border-[#4caf50] tw:checked:bg-[#4caf50]';

  return `video-optimizer-radio-surface tw:relative tw:mt-[2px] tw:mr-0 tw:mb-0 tw:ml-0 tw:size-[18px] tw:min-h-[18px] tw:min-w-[18px] tw:shrink-0 tw:cursor-pointer tw:appearance-none tw:rounded-[50%] tw:border-2 tw:bg-transparent tw:p-0 tw:[box-shadow:none] tw:focus:outline-none tw:focus:[box-shadow:none] tw:focus-visible:outline-none tw:focus-visible:[box-shadow:none] tw:hover:[box-shadow:none] ${colorClassName}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatBitrate(bps: number): string {
  return `${(bps / 1e6).toFixed(1)} Mbps`;
}

/** Resolution-aware target bitrate. Never targets higher than the current bitrate. */
function getTargetBitrate(height: number): number {
  if (height >= 2160) return 18;
  if (height >= 1440) return 12;
  if (height >= 1080) return 8;
  if (height >= 720) return 5;
  if (height >= 480) return 2.5;
  return 1;
}

export default function VideoOptimizer({ file, fileBitrate, fileSizeTooBig, variant, onOptimized, onSkip }: Props) {
  const dispatch = useAppDispatch();
  const [optimizeEnabled, setOptimizeEnabled] = React.useState(true);
  const [state, setState] = React.useState<OptimizeState>('idle');
  const [analysis, setAnalysis] = React.useState<AnalysisResult | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [estimatedSize, setEstimatedSize] = React.useState<number | null>(null);
  const [altTargetBitrateMbps, setAltTargetBitrateMbps] = React.useState(5);
  const [altHeight, setAltHeight] = React.useState(720);
  const [altEstimatedSize, setAltEstimatedSize] = React.useState<number | null>(null);
  const [selectedOption, setSelectedOption] = React.useState<'bitrate' | 'resolution'>('bitrate');
  const cancelRef = React.useRef<(() => void) | null>(null);
  const [targetBitrateMbps, setTargetBitrateMbps] = React.useState(5);

  // Auto-analyze on mount
  React.useEffect(() => {
    let canceled = false;

    async function analyze() {
      setState('analyzing');
      let input;

      try {
        const mb = await loadMediaBunny();
        input = new mb.Input({
          formats: mb.ALL_FORMATS,
          source: new mb.BlobSource(file),
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        const duration = await input.computeDuration();

        const width = videoTrack?.displayWidth || 0;
        const height = videoTrack?.displayHeight || 0;
        const bitrateMbps = fileBitrate / 1e6;
        const isHighBitrate = bitrateMbps > 5;
        let recommendedAction: 'transcode' | 'none' = 'none';
        if (isHighBitrate) {
          recommendedAction = 'transcode';
        }

        if (canceled) return;

        const result: AnalysisResult = {
          bitrateMbps,
          duration: duration || 0,
          width,
          height,
          recommendedAction,
        };

        setAnalysis(result);

        const maxBytes = WEB_PUBLISH_SIZE_LIMIT_GB * 1e9 * 0.95;
        const maxBitrateMbps = duration && duration > 0 ? (maxBytes * 8) / (duration * 1e6) : Infinity;
        const resolutionCap = getTargetBitrate(height);
        const targetMbps = Math.min(bitrateMbps, resolutionCap, maxBitrateMbps);

        setTargetBitrateMbps(targetMbps);
        setEstimatedSize(((targetMbps * 1e6 * (duration || 0)) / 8) * 1.05);

        const lowerHeight =
          height >= 2160 ? 1440 : height >= 1440 ? 1080 : height >= 1080 ? 720 : height >= 720 ? 480 : 360;
        const altResolutionCap = getTargetBitrate(lowerHeight);
        const altBitrate = Math.min(bitrateMbps, altResolutionCap, maxBitrateMbps);

        setAltHeight(lowerHeight);
        setAltTargetBitrateMbps(altBitrate);
        setAltEstimatedSize(((altBitrate * 1e6 * (duration || 0)) / 8) * 1.05);

        setState('ready');
      } catch (e) {
        console.error('[VideoOptimizer] Analysis failed:', e); // eslint-disable-line no-console
        if (!canceled) {
          setState('error');
          setAnalysis(null);
        }
      } finally {
        if (input) {
          input.dispose();
        }
      }
    }

    analyze();
    return () => {
      canceled = true;
    };
  }, [file, fileBitrate]);

  async function handleOptimize() {
    if (!analysis) return;
    setState('optimizing');
    setProgress(0);
    let input;

    try {
      const mb = await loadMediaBunny();
      input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.BlobSource(file),
      });

      const target = new mb.BufferTarget();
      const output = new mb.Output({
        format: new mb.Mp4OutputFormat(),
        target,
      });

      const conversion = await mb.Conversion.init({
        input,
        output,
        video: {
          codec: 'avc',
          bitrate: targetBitrateMbps * 1e6,
          keyFrameInterval: 2,
        },
        audio: {
          codec: 'aac',
          bitrate: 128_000,
        },
      });

      let canceled = false;
      cancelRef.current = () => {
        canceled = true;
        conversion.cancel();
      };

      conversion.onProgress = (p: number) => {
        if (!canceled) setProgress(p);
      };

      await conversion.execute();
      cancelRef.current = null;

      if (canceled) return;

      const optimizedBlob = new Blob([target.buffer], { type: 'video/mp4' });
      const optimizedFile = new File([optimizedBlob], file.name.replace(/\.[^.]+$/, '_optimized.mp4'), {
        type: 'video/mp4',
      });

      setState('done');
      setProgress(1);

      // Cache in IndexedDB so the file survives page refresh during upload
      const cacheKey = `optimized-${file.name}-${file.size}`;
      cacheOptimizedFile(cacheKey, optimizedFile).catch(() => {});

      dispatch(
        doToast({
          message: __('Video optimized! Size: %size%', {
            size: formatSize(optimizedFile.size),
          }),
        })
      );
      onOptimized(optimizedFile);
    } catch (e: unknown) {
      cancelRef.current = null;
      if (e instanceof Error && e.message?.includes('cancel')) {
        setState('ready');
        setProgress(0);
        return;
      }
      console.error('[VideoOptimizer] Optimization failed:', e); // eslint-disable-line no-console
      setState('error');
      dispatch(
        doToast({
          isError: true,
          message: __('Video optimization failed. You can still publish the original.'),
        })
      );
    } finally {
      if (input) {
        input.dispose();
      }
    }
  }

  function handleCancel() {
    cancelRef.current?.();
    cancelRef.current = null;
    setState('ready');
    setProgress(0);
  }

  // Don't show anything if not a high bitrate video
  if (state === 'idle' || state === 'analyzing') {
    return (
      <div className="tw:mt-app-s tw:flex tw:items-center tw:gap-app-xs tw:rounded-app tw:border tw:border-[rgba(var(--color-header-button-base),0.12)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:px-app-m tw:py-app-s">
        <div className="tw:size-[16px] tw:rounded-[50%] tw:border-2 tw:border-[rgba(var(--color-primary-dynamic),0.2)] tw:border-t-app-primary tw:[animation:video-opt-spin_0.6s_linear_infinite]" />
        <span className="tw:text-app-small tw:text-app-text-subtitle">{__('Analyzing video...')}</span>
      </div>
    );
  }

  if (state === 'error' || !analysis || analysis.recommendedAction === 'none') {
    return null;
  }

  const progressPercent = Math.round(progress * 100);

  return (
    <div className="tw:mt-app-s">
      <div className={publishStatusCardClassName}>
        <div className={publishStatusHeaderClassName}>
          <div className={publishStatusIconClassName(variant)}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className={publishStatusTextClassName}>
            <h3 className={publishStatusTitleClassName}>
              {__('Optimize Video')}
              <span
                className={`tw:ml-app-xs tw:rounded-[4px] tw:px-[8px] tw:py-[4px] tw:align-middle tw:text-app-xsmall tw:font-semibold ${optimizerLabelVariantClassNames[variant]}`}
              >
                {variant === 'mandatory' ? __('Mandatory') : variant === 'error' ? __('Required') : __('Recommended')}
              </span>
            </h3>
            <p className={publishStatusDescriptionClassName}>
              {fileSizeTooBig
                ? __(
                    'Your file size exceeds the upload limit. Choose between reducing the bitrate or lowering the resolution to fit.'
                  )
                : __(
                    'Your video bitrate is %bitrate%. Choose between reducing the bitrate or lowering the resolution.',
                    {
                      bitrate: formatBitrate(analysis.bitrateMbps * 1e6),
                    }
                  )}
            </p>
          </div>
          {state === 'ready' && (
            <label
              className={publishStatusActionClassName(variant)}
              style={variant === 'mandatory' ? { pointerEvents: 'none', opacity: 0.7 } : undefined}
            >
              <input
                className={publishStatusCheckboxClassName(variant)}
                type="checkbox"
                checked={optimizeEnabled}
                readOnly={variant === 'mandatory'}
                onChange={(e) => {
                  if (variant !== 'mandatory') {
                    setOptimizeEnabled(e.target.checked);
                    dispatch(doUpdatePublishForm({ skipOptimize: !e.target.checked }));
                  }
                }}
              />
              <span>{__('Optimize')}</span>
            </label>
          )}
        </div>

        {/* Options */}
        <div className="tw:mt-app-m tw:mb-app-m tw:flex tw:flex-col tw:gap-app-xs">
          <label className={optimizerOptionClassName(selectedOption === 'bitrate', variant)}>
            <input
              className={optimizerRadioClassName(variant)}
              type="radio"
              name="optimize_mode"
              checked={selectedOption === 'bitrate'}
              onChange={() => setSelectedOption('bitrate')}
            />
            <div className="tw:flex tw:flex-col tw:gap-[2px]">
              <strong className="tw:text-app-small tw:text-app-text">{__('Reduce Bitrate')}</strong>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-app-s tw:rounded-[8px] tw:bg-[rgba(var(--color-header-button-base),0.08)] tw:p-app-s tw:upto-small:gap-app-xs tw:upto-small:p-app-xs">
                <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                    {__('Bitrate')}
                  </span>
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-[#f5a623] tw:[font-variant-numeric:tabular-nums]">
                    {formatBitrate(analysis.bitrateMbps * 1e6)}
                  </span>
                </div>
                <div className="tw:flex tw:shrink-0 tw:items-center tw:text-app-text-subtitle tw:upto-small:hidden">
                  →
                </div>
                <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                    {__('Target')}
                  </span>
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-[#4caf50] tw:[font-variant-numeric:tabular-nums]">
                    {formatBitrate(targetBitrateMbps * 1e6)}
                  </span>
                </div>
                <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                    {__('Resolution')}
                  </span>
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle tw:[font-variant-numeric:tabular-nums]">
                    {analysis.height}p
                  </span>
                </div>
                {estimatedSize && (
                  <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                    <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                      {__('Est. Size')}
                    </span>
                    <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle tw:[font-variant-numeric:tabular-nums]">
                      {formatSize(estimatedSize)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </label>
          <label className={optimizerOptionClassName(selectedOption === 'resolution', variant)}>
            <input
              className={optimizerRadioClassName(variant)}
              type="radio"
              name="optimize_mode"
              checked={selectedOption === 'resolution'}
              onChange={() => setSelectedOption('resolution')}
            />
            <div className="tw:flex tw:flex-col tw:gap-[2px]">
              <strong className="tw:text-app-small tw:text-app-text">{__('Lower Resolution')}</strong>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-app-s tw:rounded-[8px] tw:bg-[rgba(var(--color-header-button-base),0.08)] tw:p-app-s tw:upto-small:gap-app-xs tw:upto-small:p-app-xs">
                <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                    {__('Bitrate')}
                  </span>
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-[#f5a623] tw:[font-variant-numeric:tabular-nums]">
                    {formatBitrate(analysis.bitrateMbps * 1e6)}
                  </span>
                </div>
                <div className="tw:flex tw:shrink-0 tw:items-center tw:text-app-text-subtitle tw:upto-small:hidden">
                  →
                </div>
                <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                    {__('Target')}
                  </span>
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-[#4caf50] tw:[font-variant-numeric:tabular-nums]">
                    {formatBitrate(altTargetBitrateMbps * 1e6)}
                  </span>
                </div>
                <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                    {__('Resolution')}
                  </span>
                  <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle tw:[font-variant-numeric:tabular-nums]">
                    {altHeight}p
                  </span>
                </div>
                {altEstimatedSize && (
                  <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-[2px]">
                    <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-app-text-subtitle">
                      {__('Est. Size')}
                    </span>
                    <span className="tw:whitespace-nowrap tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle tw:[font-variant-numeric:tabular-nums]">
                      {formatSize(altEstimatedSize)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </label>
        </div>

        {/* Progress bar (during optimization) */}
        {state === 'optimizing' && (
          <div className="tw:mb-app-m">
            <div className="tw:h-[6px] tw:overflow-hidden tw:rounded-[3px] tw:bg-[rgba(var(--color-header-button-base),0.15)]">
              <div
                className="tw:h-full tw:rounded-[3px] tw:bg-[linear-gradient(90deg,rgba(var(--color-primary-dynamic),0.8),var(--color-primary))] tw:[transition:width_0.3s_ease]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="tw:mt-app-xxs tw:flex tw:items-center tw:justify-between">
              <span className="tw:text-app-small tw:font-bold tw:text-app-primary tw:[font-variant-numeric:tabular-nums]">
                {progressPercent}%
              </span>
              <span className="tw:text-app-xsmall tw:text-app-text-subtitle">{__('Optimizing...')}</span>
            </div>
          </div>
        )}

        {/* Done state */}
        {state === 'done' && (
          <div className="tw:mb-app-m tw:flex tw:items-center tw:gap-app-xs tw:rounded-[8px] tw:border tw:border-[rgba(76,175,80,0.2)] tw:bg-[rgba(76,175,80,0.1)] tw:px-app-s tw:py-app-xs tw:text-app-small tw:font-semibold tw:text-[#4caf50]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{__('Video optimized and ready to publish!')}</span>
          </div>
        )}

        {state === 'optimizing' && (
          <div className="tw:mt-app-s tw:upto-small:flex-col">
            <button
              className="tw:inline-flex tw:cursor-pointer tw:items-center tw:justify-center tw:gap-[6px] tw:rounded-[8px] tw:border tw:border-[rgba(var(--color-header-button-base),0.18)] tw:bg-[rgba(var(--color-header-button-base),0.06)] tw:px-[20px] tw:py-[10px] tw:text-app-small tw:font-semibold tw:text-app-text-subtitle tw:transition-all tw:duration-150 tw:ease-[ease] tw:hover:bg-[rgba(var(--color-header-button-base),0.12)] tw:hover:text-app-text tw:upto-small:w-full"
              onClick={handleCancel}
            >
              {__('Cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
