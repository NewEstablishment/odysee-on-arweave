import React, { useEffect, useState, useRef, useCallback } from 'react';
import { THUMBNAIL_CDN_SIZE_LIMIT_BYTES } from 'config';
import { Input, BlobSource, VideoSampleSink, ALL_FORMATS } from 'odysee-media-usagi';
import type { VideoSample } from 'odysee-media-usagi';
import Button from 'component/button';
import Spinner from 'component/spinner';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import * as THUMBNAIL_STATUSES from 'constants/thumbnail_upload_statuses';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doUploadThumbnail } from 'redux/actions/publish';
import { doOpenModal } from 'redux/actions/app';
import { doToast } from 'redux/actions/notifications';

const DEFAULT_PERCENTAGES = [0.1, 0.25, 0.5, 0.75, 0.9];
const THUMBNAIL_MAX_WIDTH = 1920;
const THUMBNAIL_GRID_CLASS =
  'tw:grid tw:grid-cols-[repeat(4,1fr)] tw:gap-app-s tw:[@media(max-width:900px)]:grid-cols-[repeat(2,1fr)]';
const THUMBNAIL_ITEM_BASE_CLASS =
  'tw:relative tw:rounded-app tw:border-2 tw:border-solid tw:border-app-border tw:bg-app-card tw:p-0 tw:[transition:border-color_0.15s_ease]';
const THUMBNAIL_ITEM_CLASS = `${THUMBNAIL_ITEM_BASE_CLASS} tw:cursor-pointer tw:overflow-hidden tw:hover:border-[rgba(var(--color-primary-dynamic),0.6)]`;
const THUMBNAIL_ITEM_SELECTED_CLASS =
  'tw:border-app-primary tw:[box-shadow:0_0_0_2px_rgba(var(--color-primary-dynamic),0.3)]';
const THUMBNAIL_ITEM_SKELETON_CLASS = `${THUMBNAIL_ITEM_BASE_CLASS} tw:cursor-default tw:overflow-hidden tw:hover:border-app-border`;
const THUMBNAIL_ITEM_ACTION_CLASS =
  'tw:flex tw:aspect-video tw:items-center tw:justify-center tw:bg-app-card tw:hover:bg-app-card tw:disabled:cursor-default tw:disabled:opacity-40';
const THUMBNAIL_ITEM_CUSTOM_CLASS = `${THUMBNAIL_ITEM_BASE_CLASS} tw:relative tw:flex tw:cursor-pointer tw:flex-col tw:overflow-visible tw:hover:border-[rgba(var(--color-primary-dynamic),0.6)]`;
const THUMBNAIL_IMAGE_CLASS = 'tw:block tw:aspect-video tw:w-full tw:object-cover';
const THUMBNAIL_LABEL_CLASS =
  'tw:absolute tw:right-app-xxs tw:bottom-app-xxs tw:rounded-[calc(var(--border-radius)/2)] tw:bg-[rgba(0,0,0,0.7)] tw:px-app-xxs tw:py-[2px] tw:text-app-xsmall tw:leading-[1.3] tw:text-white';
const THUMBNAIL_CUSTOM_SLIDER_CLASS =
  'thumbnail-picker-slider-surface tw:absolute tw:right-[6px] tw:bottom-[-6px] tw:left-[6px] tw:z-[1] tw:m-0 tw:h-[16px] tw:w-auto tw:cursor-pointer tw:appearance-none tw:!bg-transparent tw:px-0 tw:py-[18px] tw:opacity-80 tw:![box-shadow:none]';
const THUMBNAIL_EXPAND_BUTTON_CLASS =
  'tw:absolute tw:top-[4px] tw:right-[4px] tw:z-[2] tw:flex tw:size-[26px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[4px] tw:![border:0] tw:bg-[rgba(0,0,0,0.6)] tw:p-0 tw:text-white tw:hover:bg-[rgba(0,0,0,0.85)]';
const THUMBNAIL_LIGHTBOX_SLIDER_CLASS =
  'thumbnail-picker-lightbox-slider-surface tw:mx-app-m tw:mt-app-s tw:mb-0 tw:block tw:h-[20px] tw:w-[calc(100%-var(--spacing-m)*2)] tw:cursor-pointer tw:appearance-none tw:!bg-transparent tw:px-0 tw:py-[14px] tw:![box-shadow:none]';
const THUMBNAIL_LIGHTBOX_CLOSE_CLASS =
  'tw:absolute tw:top-[8px] tw:right-[8px] tw:z-[1] tw:flex tw:size-[32px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[50%] tw:![border:0] tw:bg-[rgba(0,0,0,0.6)] tw:p-0 tw:text-white tw:hover:bg-[rgba(0,0,0,0.85)]';

type FrameData = {
  blobUrl: string;
  blob: Blob;
  timestamp: number;
  label: string;
};

type PickerMode = 'auto' | 'manual';

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

type Props = {
  filePath?: File;
  hasVideo?: boolean;
  remoteVideoUrl?: string;
  imageFile?: File;
  onThumbnailSelected?: (thumbnailUrl: string) => void;
};

function ThumbnailPicker(props: Props) {
  const { filePath, hasVideo = false, remoteVideoUrl, imageFile, onThumbnailSelected } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedThumbUrl, setUploadedThumbUrl] = useState<string | null>(null);
  const [urlThumbUrl, setUrlThumbUrl] = useState<string | null>(null);
  const currentThumbnail = useAppSelector((state) => state.publish.thumbnail);
  const uploadThumbnailStatus = useAppSelector((state) => state.publish.uploadThumbnailStatus);
  const editingURI = useAppSelector((state) => state.publish.editingURI);
  const dispatch = useAppDispatch();

  const [frames, setFrames] = useState<FrameData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [mode, setMode] = useState<PickerMode>('auto');
  const [duration, setDuration] = useState(0);
  const [manualTimestamp, setManualTimestamp] = useState(0);
  const [manualFrame, setManualFrame] = useState<FrameData | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [extractorExpanded, setExtractorExpanded] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const expandedVideoRef = useRef<HTMLVideoElement>(null);

  const inputRef = useRef<Input | null>(null);
  const frameUrlsRef = useRef<string[]>([]);
  const manualVideoRef = useRef<HTMLVideoElement>(null);
  const manualVideoUrlRef = useRef<string | null>(null);
  const uploadedPreviewUrlRef = useRef<string | null>(null);
  const extractionIdRef = useRef(0);
  const manualFrameUrlRef = useRef<string | null>(null);
  const isUploadInProgress = uploading || uploadThumbnailStatus === THUMBNAIL_STATUSES.IN_PROGRESS;

  const cleanupFrameUrls = useCallback((urls?: string[]) => {
    const urlsToRevoke = urls || frameUrlsRef.current;
    urlsToRevoke.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));

    if (!urls) {
      frameUrlsRef.current = [];
    }
  }, []);

  const cleanupInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.dispose();
      inputRef.current = null;
    }
  }, []);

  const cleanupManualFrame = useCallback(() => {
    if (manualFrameUrlRef.current) {
      URL.revokeObjectURL(manualFrameUrlRef.current);
      manualFrameUrlRef.current = null;
    }
  }, []);

  const cleanupUploadedPreview = useCallback(() => {
    if (uploadedPreviewUrlRef.current) {
      URL.revokeObjectURL(uploadedPreviewUrlRef.current);
      uploadedPreviewUrlRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    extractionIdRef.current += 1;
    cleanupFrameUrls();
    cleanupManualFrame();
    cleanupUploadedPreview();
    cleanupInput();
    if (manualVideoUrlRef.current) {
      URL.revokeObjectURL(manualVideoUrlRef.current);
      manualVideoUrlRef.current = null;
    }
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [cleanupFrameUrls, cleanupInput, cleanupManualFrame, cleanupUploadedPreview]);

  const extractFrames = useCallback(
    async (percentages: number[]) => {
      const extractionId = extractionIdRef.current + 1;
      extractionIdRef.current = extractionId;

      setLoading(true);
      setError(null);
      setExtractionFailed(false);
      setSelectedIndex(null);
      setFrames([]);
      setDuration(0);
      cleanupManualFrame();
      setManualFrame(null);
      cleanupFrameUrls();
      cleanupInput();

      let input: Input | null = null;
      let newFrameUrls: string[] = [];

      try {
        const source = new BlobSource(filePath);
        input = new Input({ formats: ALL_FORMATS, source });
        inputRef.current = input;

        const duration = await input.computeDuration();
        if (extractionId === extractionIdRef.current) {
          setDuration(duration || 0);
        }
        const videoTrack = await input.getPrimaryVideoTrack();

        if (!videoTrack) {
          if (extractionId === extractionIdRef.current) {
            setError(__('No video track found in the file.'));
          }
          return;
        }

        const sink = new VideoSampleSink(videoTrack);
        const timestamps = percentages.map((p) => p * duration);
        const newFrames: FrameData[] = [];

        for await (const sample of sink.samplesAtTimestamps(timestamps)) {
          if (!sample) {
            continue;
          }

          if (extractionId !== extractionIdRef.current) {
            sample.close();
            return;
          }

          const blob = await videoSampleToBlob(sample);
          if (blob) {
            const blobUrl = URL.createObjectURL(blob);
            newFrames.push({
              blobUrl,
              blob,
              timestamp: sample.timestamp,
              label: formatTimestamp(sample.timestamp),
            });
            newFrameUrls.push(blobUrl);
          }
          sample.close();
        }

        if (extractionId !== extractionIdRef.current) {
          cleanupFrameUrls(newFrameUrls);
          return;
        }

        frameUrlsRef.current = newFrameUrls;
        setFrames(newFrames);

        if (newFrames.length > 0) {
          setSelectedIndex(0);
          uploadFrame(newFrames[0]);
        } else {
          setError(__('Could not extract any frames from the video.'));
        }
      } catch (err) {
        console.warn('[ThumbnailPicker] WebCodecs failed, falling back to video element'); // eslint-disable-line no-console
        cleanupFrameUrls(newFrameUrls);
        if (extractionId === extractionIdRef.current && filePath) {
          try {
            const videoUrl = URL.createObjectURL(filePath);
            const video = document.createElement('video');
            video.muted = true;
            video.preload = 'auto';
            video.src = videoUrl;
            await new Promise<void>((resolve, reject) => {
              video.addEventListener('loadedmetadata', () => resolve(), { once: true });
              video.addEventListener('error', () => reject(new Error('Failed to load video')), { once: true });
            });
            const dur = video.duration;
            if (extractionId === extractionIdRef.current) setDuration(dur);
            const timestamps = percentages.map((p) => p * dur);
            const fallbackFrames: FrameData[] = [];
            const fallbackUrls: string[] = [];
            for (const ts of timestamps) {
              if (extractionId !== extractionIdRef.current) break;
              video.currentTime = ts;
              await new Promise<void>((resolve) => {
                video.addEventListener('seeked', () => resolve(), { once: true });
              });
              const canvas = new OffscreenCanvas(video.videoWidth || 320, video.videoHeight || 180);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
                const blobUrl = URL.createObjectURL(blob);
                fallbackUrls.push(blobUrl);
                fallbackFrames.push({ blobUrl, blob, timestamp: ts, label: formatTimestamp(ts) });
              }
            }
            URL.revokeObjectURL(videoUrl);
            if (extractionId === extractionIdRef.current) {
              frameUrlsRef.current = fallbackUrls;
              setFrames(fallbackFrames);
              if (fallbackFrames.length > 0) {
                setSelectedIndex(0);
                uploadFrame(fallbackFrames[0]);
              }
            } else {
              fallbackUrls.forEach((u) => URL.revokeObjectURL(u));
            }
          } catch {
            if (extractionId === extractionIdRef.current) setExtractionFailed(true);
          }
        } else if (extractionId === extractionIdRef.current) {
          setExtractionFailed(true);
        }
      } finally {
        if (inputRef.current === input) {
          cleanupInput();
        } else if (input) {
          input.dispose();
        }

        if (extractionId === extractionIdRef.current) {
          setLoading(false);
        }
      }
    },
    [cleanupFrameUrls, cleanupInput, filePath]
  );

  const extractRemoteFrames = useCallback(
    async (videoUrl: string, percentages: number[]) => {
      const extractionId = extractionIdRef.current + 1;
      extractionIdRef.current = extractionId;
      setLoading(true);
      setError(null);
      setExtractionFailed(false);
      setSelectedIndex(null);
      setFrames([]);
      cleanupFrameUrls();

      try {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'auto';
        video.src = videoUrl;

        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error('Failed to load video')), { once: true });
        });

        const dur = video.duration;
        if (extractionId === extractionIdRef.current) setDuration(dur);
        const timestamps = percentages.map((p) => p * dur);
        const newFrames: FrameData[] = [];
        const newUrls: string[] = [];

        for (const ts of timestamps) {
          if (extractionId !== extractionIdRef.current) break;
          video.currentTime = ts;
          await new Promise<void>((resolve) => {
            video.addEventListener('seeked', () => resolve(), { once: true });
          });
          const canvas = new OffscreenCanvas(video.videoWidth || 320, video.videoHeight || 180);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
            const blobUrl = URL.createObjectURL(blob);
            newUrls.push(blobUrl);
            newFrames.push({ blobUrl, blob, timestamp: ts, label: formatTimestamp(ts) });
          }
        }

        if (extractionId === extractionIdRef.current) {
          frameUrlsRef.current = newUrls;
          setFrames(newFrames);
          if (newFrames.length > 0) {
            setSelectedIndex(0);
            uploadFrame(newFrames[0]);
          }
        }
      } catch {
        if (extractionId === extractionIdRef.current) {
          setExtractionFailed(true);
        }
      }

      if (extractionId === extractionIdRef.current) setLoading(false);
    },
    [cleanupFrameUrls]
  );

  useEffect(() => {
    setMode('auto');
    setManualTimestamp(0);
    setManualFrame(null);
    if (editingURI && currentThumbnail) {
      setSelectedIndex(-4);
      setLoading(false);
    } else if (hasVideo && filePath) {
      extractFrames(DEFAULT_PERCENTAGES);
    } else if (hasVideo && remoteVideoUrl) {
      extractRemoteFrames(remoteVideoUrl, DEFAULT_PERCENTAGES);
    } else if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImagePreviewUrl(url);
      setSelectedIndex(-5);
      setLoading(false);
      uploadFrame({ blobUrl: url, blob: imageFile, timestamp: 0, label: __('Source image') });
    } else {
      setLoading(false);
    }

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, remoteVideoUrl, imageFile]);

  useEffect(() => {
    if (
      uploadedPreviewUrlRef.current &&
      uploadThumbnailStatus !== THUMBNAIL_STATUSES.IN_PROGRESS &&
      uploadThumbnailStatus !== THUMBNAIL_STATUSES.COMPLETE &&
      uploadedThumbUrl === uploadedPreviewUrlRef.current
    ) {
      cleanupUploadedPreview();
      setUploadedThumbUrl(null);
      if (selectedIndex === -2) setSelectedIndex(null);
    }
  }, [cleanupUploadedPreview, selectedIndex, uploadThumbnailStatus, uploadedThumbUrl]);

  function handleRegenerate() {
    const randomPercentages = Array.from({ length: 5 }, () => 0.05 + Math.random() * 0.9).sort((a, b) => a - b);
    extractFrames(randomPercentages);
  }

  function handleShowManualMode() {
    const nextTimestamp =
      selectedIndex !== null && frames[selectedIndex] ? frames[selectedIndex].timestamp : duration ? duration / 2 : 0;

    setError(null);
    cleanupManualFrame();
    setManualFrame(null);
    setManualTimestamp(nextTimestamp);
    setMode('manual');
  }

  async function handleManualPreview() {
    if (!duration) return;

    setError(null);
    setManualLoading(true);
    cleanupManualFrame();
    setManualFrame(null);

    let input: Input | null = null;

    try {
      const source = new BlobSource(filePath);
      input = new Input({ formats: ALL_FORMATS, source });

      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        setError(__('No video track found in the file.'));
        return;
      }

      const sink = new VideoSampleSink(videoTrack);
      for await (const sample of sink.samplesAtTimestamps([manualTimestamp])) {
        if (!sample) {
          continue;
        }

        const blob = await videoSampleToBlob(sample);
        const timestamp = sample.timestamp;
        const blobUrl = blob ? URL.createObjectURL(blob) : null;
        sample.close();

        if (!blob || !blobUrl) {
          break;
        }

        manualFrameUrlRef.current = blobUrl;
        setManualFrame({
          blobUrl,
          blob,
          timestamp,
          label: formatTimestamp(timestamp),
        });
        return;
      }

      setError(__('Could not extract a frame at that position.'));
    } catch (err) {
      console.error('ThumbnailPicker: manual frame extraction failed', err); // eslint-disable-line no-console
      setError(__("Something didn't work. Please try again."));
    } finally {
      if (input) {
        input.dispose();
      }
      setManualLoading(false);
    }
  }

  async function uploadFrame(frame: FrameData) {
    if (uploading) return;
    setUploading(true);
    try {
      let file = new File([frame.blob], 'thumbnail.jpeg', { type: 'image/jpeg' });
      if (file.size > THUMBNAIL_CDN_SIZE_LIMIT_BYTES) {
        const lowerBlob = await reEncodeBlob(frame.blobUrl, 0.7);
        if (lowerBlob) {
          file = new File([lowerBlob], 'thumbnail.jpeg', { type: 'image/jpeg' });
        }
      }
      await Promise.resolve(
        dispatch(doUploadThumbnail(undefined, file, undefined, undefined, undefined, onThumbnailSelected))
      );
    } catch (err) {
      dispatch(doToast({ isError: true, message: __("Something didn't work. Please try again.") }));
    }
    setUploading(false);
  }

  async function captureCustomFrame(): Promise<FrameData | null> {
    const video = manualVideoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, blob, timestamp: video.currentTime, label: formatTimestamp(video.currentTime) };
  }

  async function handleUpload() {
    let frame: FrameData | null = null;
    if (selectedIndex === -1) {
      frame = await captureCustomFrame();
    } else if (selectedIndex !== null && frames[selectedIndex]) {
      frame = frames[selectedIndex];
    }

    if (!frame) return;
    setUploading(true);

    try {
      let file = new File([frame.blob], 'thumbnail.jpeg', {
        type: 'image/jpeg',
      });

      if (file.size > THUMBNAIL_CDN_SIZE_LIMIT_BYTES) {
        // Re-encode at lower quality
        const lowerBlob = await reEncodeBlob(frame.blobUrl, 0.7);
        if (lowerBlob) {
          file = new File([lowerBlob], 'thumbnail.jpeg', {
            type: 'image/jpeg',
          });
        }
      }

      await Promise.resolve(
        dispatch(doUploadThumbnail(undefined, file, undefined, undefined, undefined, onThumbnailSelected))
      );
    } catch (err) {
      dispatch(
        doToast({
          isError: true,
          message: __("Something didn't work. Please try again."),
        })
      );
    }

    setUploading(false);
  }

  return (
    <div className="tw:w-full">
      {mode === 'auto' && (
        <>
          {loading && (
            <div className="tw:relative">
              <div className={`${THUMBNAIL_GRID_CLASS} tw:pointer-events-none`}>
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className={THUMBNAIL_ITEM_SKELETON_CLASS}>
                    <div className="tw:aspect-video tw:w-full tw:bg-[linear-gradient(90deg,var(--color-card-background)_25%,rgba(var(--color-border-base),0.3)_50%,var(--color-card-background)_75%)] tw:bg-[length:200%_100%] tw:[animation:thumbnail-picker-shimmer_1.5s_infinite]" />
                  </div>
                ))}
              </div>
              <div className="tw:flex tw:items-center tw:justify-center tw:gap-app-s tw:py-app-m">
                <Spinner type="small" text={<span>{__('Extracting frames')}...</span>} />
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="tw:flex tw:flex-col tw:items-center tw:gap-app-s tw:py-app-l tw:text-app-text-subtitle">
              <p>{error}</p>
              <Button button="secondary" label={__('Try again')} onClick={handleRegenerate} />
            </div>
          )}

          {!loading && !error && (
            <>
              <div className={THUMBNAIL_GRID_CLASS}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.gif,.webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      cleanupUploadedPreview();
                      const previewUrl = URL.createObjectURL(file);
                      uploadedPreviewUrlRef.current = previewUrl;
                      dispatch(
                        doOpenModal(MODALS.CONFIRM_THUMBNAIL_UPLOAD, {
                          file,
                          previewUrl,
                          onUploadStarted: () => {
                            setUploadedThumbUrl(previewUrl);
                            setSelectedIndex(-2);
                          },
                          onUploadCanceled: () => {
                            cleanupUploadedPreview();
                            setUploadedThumbUrl(null);
                            if (selectedIndex === -2) setSelectedIndex(null);
                          },
                          cb: (url: string) => {
                            setUploadedThumbUrl((currentUrl) => currentUrl || url);
                            setSelectedIndex(-2);
                            onThumbnailSelected?.(url);
                          },
                        })
                      );
                    }
                    e.target.value = '';
                  }}
                />
                <button
                  className={`${THUMBNAIL_ITEM_CLASS} ${uploadedThumbUrl ? '' : THUMBNAIL_ITEM_ACTION_CLASS} ${
                    selectedIndex === -2 ? THUMBNAIL_ITEM_SELECTED_CLASS : ''
                  }`}
                  onClick={() => {
                    if (uploadedThumbUrl) {
                      setSelectedIndex(-2);
                    } else if (!isUploadInProgress) {
                      fileInputRef.current?.click();
                    }
                  }}
                  disabled={isUploadInProgress && !uploadedThumbUrl}
                  type="button"
                >
                  {uploadedThumbUrl ? (
                    <>
                      <img src={uploadedThumbUrl} className={THUMBNAIL_IMAGE_CLASS} alt={__('Uploaded thumbnail')} />
                      {selectedIndex === -2 && isUploadInProgress && (
                        <span className="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-xs tw:bg-[rgba(0,0,0,0.55)] tw:text-app-small tw:font-bold tw:text-white">
                          <Spinner type="small" />
                          <span>{__('Uploading')}...</span>
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="tw:flex tw:flex-col tw:items-center tw:gap-app-xxs tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle">
                      <Icon icon={ICONS.PUBLISH} size={24} />
                      <span>{__('Upload')}</span>
                    </div>
                  )}
                </button>
                <button
                  className={`${THUMBNAIL_ITEM_CLASS} ${urlThumbUrl ? '' : THUMBNAIL_ITEM_ACTION_CLASS} ${
                    selectedIndex === -3 ? THUMBNAIL_ITEM_SELECTED_CLASS : ''
                  }`}
                  onClick={() => {
                    if (urlThumbUrl) {
                      setSelectedIndex(-3);
                    } else {
                      dispatch(
                        doOpenModal(MODALS.CONFIRM_THUMBNAIL_URL, {
                          cb: (url: string) => {
                            setUrlThumbUrl(url);
                            setSelectedIndex(-3);
                          },
                        })
                      );
                    }
                  }}
                  type="button"
                >
                  {urlThumbUrl ? (
                    <img src={urlThumbUrl} className={THUMBNAIL_IMAGE_CLASS} alt={__('URL thumbnail')} />
                  ) : (
                    <div className="tw:flex tw:flex-col tw:items-center tw:gap-app-xxs tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle">
                      <Icon icon={ICONS.COPY_LINK} size={24} />
                      <span>{__('URL')}</span>
                    </div>
                  )}
                </button>
                {editingURI && currentThumbnail && (
                  <button
                    className={`${THUMBNAIL_ITEM_CLASS} ${selectedIndex === -4 ? THUMBNAIL_ITEM_SELECTED_CLASS : ''}`}
                    onClick={() => {
                      setSelectedIndex(-4);
                      onThumbnailSelected?.(currentThumbnail);
                    }}
                    type="button"
                  >
                    <img src={currentThumbnail} className={THUMBNAIL_IMAGE_CLASS} alt={__('Current thumbnail')} />
                    <span className={THUMBNAIL_LABEL_CLASS}>{__('Current')}</span>
                  </button>
                )}
                {imagePreviewUrl && (
                  <button
                    className={`${THUMBNAIL_ITEM_CLASS} ${selectedIndex === -5 ? THUMBNAIL_ITEM_SELECTED_CLASS : ''}`}
                    onClick={() => {
                      setSelectedIndex(-5);
                      if (imageFile) {
                        uploadFrame({
                          blobUrl: imagePreviewUrl,
                          blob: imageFile,
                          timestamp: 0,
                          label: __('Source image'),
                        });
                      }
                    }}
                    type="button"
                  >
                    <img src={imagePreviewUrl} className={THUMBNAIL_IMAGE_CLASS} alt={__('Source image')} />
                    <span className={THUMBNAIL_LABEL_CLASS}>{__('Source')}</span>
                  </button>
                )}
                {hasVideo && (filePath || remoteVideoUrl) && !extractionFailed && (
                  <button
                    className={`${THUMBNAIL_ITEM_CUSTOM_CLASS} ${
                      selectedIndex === -1 ? THUMBNAIL_ITEM_SELECTED_CLASS : ''
                    }`}
                    type="button"
                    onClick={async () => {
                      setSelectedIndex(-1);
                      const frame = await captureCustomFrame();
                      if (frame) uploadFrame(frame);
                    }}
                  >
                    <video
                      ref={(el) => {
                        manualVideoRef.current = el;
                        if (el && !manualVideoUrlRef.current) {
                          if (filePath) {
                            manualVideoUrlRef.current = URL.createObjectURL(filePath);
                          } else if (remoteVideoUrl) {
                            manualVideoUrlRef.current = remoteVideoUrl;
                          }
                          if (manualVideoUrlRef.current) {
                            el.src = manualVideoUrlRef.current;
                            el.currentTime = 0;
                          }
                        }
                      }}
                      className={`tw:block tw:aspect-video tw:w-full tw:bg-black tw:object-cover ${
                        selectedIndex === -1 ? 'tw:opacity-100' : 'tw:opacity-40'
                      }`}
                      muted
                      playsInline
                      disablePictureInPicture
                    />
                    <div
                      className={`tw:pointer-events-none tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-app-xxs tw:text-app-xsmall tw:font-semibold tw:text-app-text-subtitle ${
                        selectedIndex === -1 ? 'tw:opacity-0' : ''
                      }`}
                    >
                      <Icon icon={ICONS.CAMERA} size={24} />
                      <span>{__('Custom')}</span>
                    </div>
                    <input
                      className={THUMBNAIL_CUSTOM_SLIDER_CLASS}
                      type="range"
                      min={0}
                      max={duration || 1}
                      step={Math.max((duration || 1) / 200, 0.25)}
                      value={manualTimestamp}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const ts = Number(e.target.value);
                        setManualTimestamp(ts);
                        setSelectedIndex(-1);
                        if (manualVideoRef.current) manualVideoRef.current.currentTime = ts;
                      }}
                      onMouseUp={async () => {
                        const frame = await captureCustomFrame();
                        if (frame) uploadFrame(frame);
                      }}
                      onTouchEnd={async () => {
                        const frame = await captureCustomFrame();
                        if (frame) uploadFrame(frame);
                      }}
                    />
                    <button
                      className={THUMBNAIL_EXPAND_BUTTON_CLASS}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExtractorExpanded(true);
                      }}
                    >
                      <svg
                        width={14}
                        height={14}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="15 3 21 3 21 9" />
                        <polyline points="9 21 3 21 3 15" />
                        <line x1="21" y1="3" x2="14" y2="10" />
                        <line x1="3" y1="21" x2="10" y2="14" />
                      </svg>
                    </button>
                  </button>
                )}
                {frames.map((frame, index) => (
                  <button
                    key={frame.blobUrl}
                    className={`${THUMBNAIL_ITEM_CLASS} ${
                      selectedIndex === index ? THUMBNAIL_ITEM_SELECTED_CLASS : ''
                    }`}
                    onClick={() => {
                      setSelectedIndex(index);
                      uploadFrame(frames[index]);
                    }}
                    type="button"
                  >
                    <img
                      src={frame.blobUrl}
                      alt={__('Thumbnail at %timestamp%', { timestamp: frame.label })}
                      className={THUMBNAIL_IMAGE_CLASS}
                    />
                    <span className={THUMBNAIL_LABEL_CLASS}>{frame.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {mode === 'manual' && duration > 0 && (
        <div className="tw:flex tw:flex-col tw:gap-app-m">
          <div className="tw:mb-app-m tw:flex tw:items-start tw:justify-between tw:gap-app-m">
            <div>
              <h3 className="tw:m-0">{__('Manual frame selection')}</h3>
              <p className="tw:mt-app-xxs tw:mr-0 tw:mb-0 tw:ml-0 tw:text-app-text-subtitle">
                {__('Scrub through the video to find the perfect frame.')}
              </p>
            </div>
            <Button
              button="link"
              label={__('Back to auto')}
              onClick={() => {
                setError(null);
                setMode('auto');
              }}
              disabled={manualLoading || uploading}
            />
          </div>

          {/* Video scrubber */}
          <div className="tw:aspect-video tw:max-w-full tw:overflow-hidden tw:rounded-app tw:bg-black">
            <video
              ref={(el) => {
                manualVideoRef.current = el;
                if (el && !manualVideoUrlRef.current) {
                  manualVideoUrlRef.current = URL.createObjectURL(filePath);
                  el.src = manualVideoUrlRef.current;
                  el.currentTime = manualTimestamp;
                }
              }}
              className="tw:block tw:h-full tw:w-full tw:object-contain"
              muted
              playsInline
            />
          </div>

          <div className="tw:flex tw:flex-col tw:gap-app-s">
            <div className="tw:flex tw:items-center tw:gap-app-s">
              <input
                id="thumbnail-picker-manual-range"
                className="tw:flex-1"
                type="range"
                min={0}
                max={duration}
                step={Math.max(duration / 200, 0.25)}
                value={manualTimestamp}
                onChange={(event) => {
                  const ts = Number(event.target.value);
                  setManualTimestamp(ts);
                  if (manualVideoRef.current) manualVideoRef.current.currentTime = ts;
                }}
              />
              <span className="tw:min-w-[3.5rem] tw:text-right tw:tabular-nums">
                {formatTimestamp(manualTimestamp)}
              </span>
            </div>
          </div>

          {error && (
            <div className="tw:flex tw:flex-col tw:items-center tw:gap-app-s tw:py-app-l tw:text-app-text-subtitle">
              <p>{error}</p>
            </div>
          )}

          <div className="tw:mt-app-m tw:flex tw:flex-wrap tw:items-center tw:gap-app-m">
            <Button
              button="secondary"
              label={manualLoading ? __('Capturing...') : __('Capture this frame')}
              onClick={handleManualPreview}
              disabled={manualLoading || uploading}
            />
          </div>

          {manualFrame && (
            <div className="tw:max-w-[28rem]">
              <div className={`${THUMBNAIL_ITEM_CLASS} ${THUMBNAIL_ITEM_SELECTED_CLASS}`}>
                <img
                  src={manualFrame.blobUrl}
                  alt={__('Thumbnail at %timestamp%', { timestamp: manualFrame.label })}
                  className={THUMBNAIL_IMAGE_CLASS}
                />
                <span className={THUMBNAIL_LABEL_CLASS}>{manualFrame.label}</span>
              </div>
              <div className="tw:mt-app-m tw:flex tw:flex-wrap tw:items-center tw:gap-app-m">
                <Button
                  button="primary"
                  label={uploading ? __('Uploading...') : __('Use this frame')}
                  disabled={manualLoading || uploading}
                  onClick={handleUpload}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {extractorExpanded && (filePath || remoteVideoUrl) && (
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-[rgba(0,0,0,0.75)] tw:backdrop-blur-[4px] tw:[animation:thumbnail-lightbox-in_0.2s_ease]"
          onClick={() => setExtractorExpanded(false)}
        >
          <div
            className="tw:relative tw:w-[90vw] tw:max-w-[900px] tw:overflow-hidden tw:rounded-app tw:bg-app-card tw:[animation:thumbnail-lightbox-scale_0.2s_ease] tw:[box-shadow:0_20px_60px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={(el) => {
                expandedVideoRef.current = el;
                if (el && manualVideoUrlRef.current) {
                  el.src = manualVideoUrlRef.current;
                  el.currentTime = manualTimestamp;
                }
              }}
              className="tw:block tw:aspect-video tw:w-full tw:bg-black tw:object-contain"
              muted
              playsInline
              disablePictureInPicture
            />
            <input
              className={THUMBNAIL_LIGHTBOX_SLIDER_CLASS}
              type="range"
              min={0}
              max={duration || 1}
              step={Math.max((duration || 1) / 500, 0.1)}
              value={manualTimestamp}
              onChange={(e) => {
                const ts = Number(e.target.value);
                setManualTimestamp(ts);
                if (expandedVideoRef.current) expandedVideoRef.current.currentTime = ts;
                if (manualVideoRef.current) manualVideoRef.current.currentTime = ts;
              }}
            />
            <div className="tw:flex tw:justify-center tw:py-app-xxs">
              <span className="tw:text-app-small tw:tabular-nums tw:text-app-text-subtitle">
                {formatTimestamp(manualTimestamp)}
              </span>
            </div>
            <div className="tw:flex tw:justify-center tw:gap-app-s tw:pt-app-s tw:pr-app-m tw:pb-app-m tw:pl-app-m">
              <Button
                button="primary"
                label={uploading ? __('Uploading...') : __('Use this frame')}
                disabled={uploading}
                onClick={async () => {
                  setSelectedIndex(-1);
                  const frame = await captureCustomFrame();
                  if (frame) uploadFrame(frame);
                  setExtractorExpanded(false);
                }}
              />
              <Button button="secondary" label={__('Close')} onClick={() => setExtractorExpanded(false)} />
            </div>
            <button
              className={THUMBNAIL_LIGHTBOX_CLOSE_CLASS}
              type="button"
              onClick={() => setExtractorExpanded(false)}
            >
              <Icon icon={ICONS.REMOVE} size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

async function videoSampleToBlob(sample: VideoSample): Promise<Blob | null> {
  try {
    const width = sample.displayWidth;
    const height = sample.displayHeight;

    if (!width || !height) {
      return null;
    }

    const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / width);
    const canvasWidth = Math.round(width * scale);
    const canvasHeight = Math.round(height * scale);

    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    sample.draw(ctx, 0, 0, canvasWidth, canvasHeight);

    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.9,
    });
    return blob;
  } catch {
    return null;
  }
}

async function reEncodeBlob(blobUrl: string, quality: number): Promise<Blob | null> {
  try {
    const response = await fetch(blobUrl);
    const originalBlob = await response.blob();
    const bitmap = await createImageBitmap(originalBlob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } catch {
    return null;
  }
}

export default ThumbnailPicker;
