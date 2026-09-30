import { ERROR_TEXT_CLASS } from 'component/common/error-classes';
import React from 'react';
import { THUMBNAIL_CDN_SIZE_LIMIT_BYTES } from 'config';
import FileSelector from 'component/common/file-selector';
import { FormField, Form } from 'component/common/form';
import Button from 'component/button';
import Card from 'component/common/card';
import usePersistedState from 'effects/use-persisted-state';
import Icon from 'component/common/icon';
// @ts-ignore
import ReactCrop, { centerCrop, makeAspectCrop, Crop, PixelCrop } from 'react-image-crop';
import * as ICONS from 'constants/icons';
import uploadThumbnail from 'services/thumbnailUpload';
import { SELECT_ASSET_CLASSES } from './classes';
const accept = '.png, .jpg, .jpeg, .gif, .webp';
const STATUS = {
  READY: 'READY',
  UPLOADING: 'UPLOADING',
};
type Props = {
  assetName: string;
  currentValue: string | null | undefined;
  otherValue: string | null | undefined;
  onUpdate: (arg0: any, arg1: any) => void;
  recommended: string;
  title?: string;
  onDone?: () => void;
  inline?: boolean;
};

async function canvasPreview(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  crop: PixelCrop,
  scale = 1,
  rotate = 0
) {
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No 2d context');
  }

  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const pixelRatio = window.devicePixelRatio;
  canvas.width = Math.floor(crop.width * scaleX * pixelRatio);
  canvas.height = Math.floor(crop.height * scaleY * pixelRatio);
  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingQuality = 'high';
  const cropX = crop.x * scaleX;
  const cropY = crop.y * scaleY;
  const rotateRads = rotate * (Math.PI / 180);
  const centerX = image.naturalWidth / 2;
  const centerY = image.naturalHeight / 2;
  ctx.save();
  ctx.translate(-cropX, -cropY);
  ctx.translate(centerX, centerY);
  ctx.rotate(rotateRads);
  ctx.scale(scale, scale);
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, image.naturalWidth, image.naturalHeight);
  ctx.restore();
}

function SelectAsset(props: Props) {
  const { onUpdate, onDone, assetName, currentValue, otherValue, recommended, title, inline } = props;
  const [pathSelected, setPathSelected] = React.useState('');
  const [fileSelected, setFileSelected] = React.useState<any>(null);
  const [uploadStatus, setUploadStatus] = React.useState(STATUS.READY);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [crop, setCrop] = React.useState<Crop>();
  const [completedCrop, setCompletedCrop] = React.useState<PixelCrop>();
  const imgRef = React.useRef(null);
  const previewCanvasRef = React.useRef(null);
  const isAnimated =
    (fileSelected && (fileSelected.type.includes('gif') || fileSelected.type.includes('webm'))) || false;
  const [cropInit, setCropInit] = React.useState(false);
  const [useUrl, setUseUrl] = usePersistedState('thumbnail-upload:mode', false);
  const [url, setUrl] = React.useState(currentValue);
  const [uploadErrorMsg, setUploadErrorMsg] = React.useState<string | undefined>();
  const [imageTitle, setImageTitle] = React.useState<string | undefined>();
  React.useEffect(() => {
    if (useUrl) {
      setUploadErrorMsg('');
      setFileSelected(null);
      setPathSelected('');
    }
  }, [useUrl]);
  React.useEffect(() => {
    if (fileSelected) {
      setCropInit(false);
    }
  }, [fileSelected]);

  function useDebounceEffect(fn: () => void, waitTime: number, deps?: any) {
    React.useEffect(() => {
      const t = setTimeout(() => {
        fn.apply(undefined, deps);
      }, waitTime);
      return () => {
        clearTimeout(t);
      };
    }, [deps, fn, waitTime]);
  }

  useDebounceEffect(
    () => {
      const execute = async () => {
        if (completedCrop?.width && completedCrop?.height && imgRef.current && previewCanvasRef.current) {
          await canvasPreview(imgRef.current, previewCanvasRef.current, completedCrop);
        }
      };

      execute();
    },
    100,
    [completedCrop]
  );

  async function doUploadAsset() {
    const uploadError = (error = '') => {
      setUploadErrorMsg(error);
    };

    const onSuccess = (thumbnailUrl) => {
      setUploadStatus(STATUS.READY);
      if (assetName !== 'Image') onUpdate(thumbnailUrl, !useUrl);
      else onUpdate(thumbnailUrl, imageTitle);

      if (onDone) {
        onDone();
      }
    };

    setUploadStatus(STATUS.UPLOADING);
    const data = new FormData();

    if ((assetName === 'Cover Image' || assetName === 'Thumbnail') && !isAnimated) {
      try {
        const file = await processCanvas();

        if (file) {
          data.append('file-input', file);
        }
      } catch (e) {
        console.log(e);
      }
    } else {
      data.append('file-input', fileSelected);
    }

    data.append('upload', 'Upload');
    return uploadThumbnail(data)
      .then((json) => {
        return json.type === 'success'
          ? onSuccess(`${json.message}`)
          : uploadError(
              json.message || __('There was an error in the upload. The format or extension might not be supported.')
            );
      })
      .catch((err) => {
        uploadError(err.message);
        setUploadStatus(STATUS.READY);
      });
  }

  function processCanvas() {
    const image = imgRef.current;
    const previewCanvas = previewCanvasRef.current;

    if (!image || !previewCanvas || !completedCrop) {
      return null;
    }

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const offscreen = document.createElement('canvas');
    offscreen.width = completedCrop.width * scaleX;
    offscreen.height = completedCrop.height * scaleY;
    const ctx = offscreen.getContext('2d');

    if (!ctx) {
      return null;
    }

    ctx.drawImage(
      previewCanvas,
      0,
      0,
      previewCanvas.width,
      previewCanvas.height,
      0,
      0,
      offscreen.width,
      offscreen.height
    );
    return new Promise<File>((resolve, reject) => {
      offscreen.toBlob((blob) => {
        if (blob) {
          resolve(
            new File([blob], 'image.png', {
              type: 'image/png',
            })
          );
        } else {
          reject(new Error('Blob creation failed.'));
        }
      }, 'image/png');
    });
  }

  function onImageLoad(e) {
    const { offsetWidth: width, offsetHeight: height } = e.currentTarget;
    const crop = centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 100,
        },
        assetName === 'Cover Image' ? 32 / 5 : 1,
        width,
        height
      ),
      width,
      height
    );
    setCrop(crop);
    const max = width > height ? height : width;
    setCompletedCrop({
      x: (width / 100) * crop.x,
      y: (100 / 100) * crop.y,
      unit: 'px',
      width: assetName === 'Cover Image' ? width : max,
      height: assetName === 'Cover Image' ? height : max,
    });
    setCropInit(true);
  }

  // Note for translators: e.g. "Thumbnail  (1:1)"
  const label = `${__(assetName)} ${__(recommended)}`;

  const selectFileLabel = __('Select File');

  const selectedLabel = pathSelected ? __('URL Selected') : __('File Selected');
  let fileSelectorLabel;

  if (uploadStatus === STATUS.UPLOADING) {
    fileSelectorLabel = __('Uploading...');
  } else {
    // Include the same label/recommendation for both 'URL' and 'UPLOAD'.
    fileSelectorLabel = `${label} ${fileSelected || pathSelected ? __(selectedLabel) : __(selectFileLabel)}`;
  }

  const currentPlaceholder = pathSelected ? imagePreview : currentValue;

  const ChannelPreview = () => {
    return (
      <div className="tw:relative tw:mt-app-s tw:h-[160px] tw:w-full tw:select-none tw:overflow-hidden tw:rounded-app tw:border-2 tw:border-app-border tw:bg-app-background">
        <div
          className="tw:aspect-[32/5] tw:w-full tw:bg-[length:100%] tw:bg-no-repeat"
          style={{
            backgroundImage:
              'url(' +
              (assetName === 'Thumbnail' ? String(otherValue) : isAnimated ? String(currentPlaceholder) : '') +
              ')',
          }}
        >
          {assetName === 'Cover Image' && fileSelected && !isAnimated && (
            <canvas className="tw:max-w-full" ref={previewCanvasRef} />
          )}
        </div>
        <div className="tw:relative tw:h-[16px] tw:w-full tw:[border-bottom:1px_solid_var(--color-header-button)] tw:bg-[var(--color-header-background)]">
          <div className="tw:absolute tw:top-[5px] tw:left-[calc(20%+50px)] tw:flex tw:gap-app-xxxs tw:upto-small:top-[6px]">
            {Array.from({ length: 8 }, (_, index) => (
              <span
                className="tw:inline-block tw:h-[6px] tw:w-[24px] tw:rounded-app tw:bg-white tw:opacity-60 tw:upto-small:h-[4px] tw:upto-small:w-[12px]"
                key={index}
              />
            ))}
          </div>
        </div>
        <div className="tw:absolute tw:top-[46px] tw:left-[20%] tw:size-[42px] tw:rounded-[50%] tw:bg-[var(--color-header-button)] tw:[box-shadow:0_1px_2px_0_black,0_2px_5px_0_rgb(0_0_0/60%)] tw:upto-small:top-[20px]">
          {otherValue && assetName === 'Cover Image' ? (
            <img className="tw:size-full tw:rounded-[50%]" src={String(otherValue)} />
          ) : !isAnimated ? (
            <canvas className="tw:size-full tw:rounded-[50%]" ref={previewCanvasRef} />
          ) : (
            <img className="tw:size-full tw:rounded-[50%]" src={String(currentPlaceholder)} />
          )}
        </div>
        <div className="tw:mx-[20%] tw:mt-[10px] tw:grid tw:h-full tw:w-[60%] tw:grid-cols-[repeat(6,1fr)] tw:gap-[10px]">
          {Array.from(Array(6), (e, i) => {
            return (
              <div key={i}>
                <div className="tw:h-[22px] tw:w-full tw:rounded-[3px] tw:bg-[var(--color-header-button)]" />
                <div className="tw:mt-[2px] tw:h-[2px] tw:w-full tw:rounded-[3px] tw:bg-app-text tw:opacity-40" />
                <div className="tw:mt-[2px] tw:h-[2px] tw:w-[90%] tw:rounded-[3px] tw:bg-app-text tw:opacity-40" />
                <div className="tw:mb-[5px] tw:inline-block tw:size-[10px] tw:rounded-[50%] tw:bg-[var(--color-header-button)]" />
                <div className="tw:ml-[2px] tw:inline-block tw:w-[calc(100%-12px)]">
                  <div className="tw:h-[2px] tw:w-full tw:rounded-[3px] tw:!bg-app-text tw:opacity-20" />
                  <div className="tw:mt-[2px] tw:mb-[7px] tw:h-[2px] tw:w-[90%] tw:rounded-[3px] tw:bg-app-text tw:opacity-20" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const formBody = (
    <>
      <div className="tw:mt-[calc(var(--spacing-l)*-1)] tw:mr-[calc(var(--spacing-l)*-1)] tw:mb-app-m tw:ml-[calc(var(--spacing-l)*-1)] tw:flex tw:w-[calc(var(--modal-width)-4px)] tw:items-center tw:rounded-[var(--border-radius)_var(--border-radius)_0_0] tw:bg-app-text-inverse tw:p-app-s tw:[&_svg]:mr-app-s tw:upto-small:mt-[calc(var(--spacing-s)*-1)] tw:upto-small:mr-[calc(var(--spacing-s)*-1)] tw:upto-small:ml-[calc(var(--spacing-s)*-1)] tw:upto-small:p-[22px]">
        <Icon icon={ICONS.IMAGE} />
        <h2 className="modal_title tw:font-black tw:leading-[1rem]">
          {title ||
            __('Choose %asset%', {
              asset: __(assetName),
            })}
        </h2>
      </div>
      <fieldset-section>
        {uploadErrorMsg && <div className={ERROR_TEXT_CLASS}>{uploadErrorMsg}</div>}
        {useUrl ? (
          <>
            <FormField
              autoFocus
              type={'text'}
              name={'thumbnail'}
              label={label}
              placeholder={`https://example.com/image.png`}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                assetName !== 'Image' && onUpdate(e.target.value, !useUrl);
              }}
            />
            {assetName === 'Image' && (
              <div>
                <FormField
                  type={'text'}
                  name={'thumbnail'}
                  label={__('Title (optional)')}
                  placeholder={__('Describe your image...')}
                  value={imageTitle}
                  onChange={(e) => {
                    setImageTitle(e.target.value);
                  }}
                />
                <div>
                  <div>{url ? <img src={String(url)} /> : <Icon icon={ICONS.IMAGE} />}</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <FileSelector
              autoFocus
              disabled={uploadStatus === STATUS.UPLOADING}
              label={fileSelectorLabel}
              name="assetSelector"
              currentPath={pathSelected}
              onFileChosen={(file) => {
                if (file.name) {
                  setFileSelected(file);
                  // what why? why not target=WEB this?
                  // file.path is undefined in web but available in electron
                  setPathSelected(file.name || file.path);
                  setUploadErrorMsg('');
                  setImagePreview(URL.createObjectURL(file as any));

                  if (file.size >= THUMBNAIL_CDN_SIZE_LIMIT_BYTES) {
                    const maxSizeMB = THUMBNAIL_CDN_SIZE_LIMIT_BYTES / (1024 * 1024);
                    setUploadErrorMsg(
                      __('Thumbnail size over %max_size%MB, please edit and reupload.', {
                        max_size: maxSizeMB,
                      })
                    );
                  }
                }
              }}
              accept={accept}
            />

            {assetName === 'Image' && (
              <div className="tw:mt-app-s">
                <FormField
                  type={'text'}
                  name={'thumbnail'}
                  label={__('Title (optional)')}
                  placeholder={__('Describe your image...')}
                  value={imageTitle}
                  onChange={(e) => {
                    setImageTitle(e.target.value);
                  }}
                />
                <div className="tw:mt-app-s tw:min-h-[40px] tw:w-full tw:rounded-app tw:bg-[var(--color-header-button)] tw:p-app-s tw:text-center">
                  <div className={SELECT_ASSET_CLASSES.preview}>
                    {currentPlaceholder ? (
                      <img
                        className="tw:mb-app-xs tw:max-w-[50%] tw:rounded-app tw:border-2 tw:border-app-border"
                        src={String(currentPlaceholder)}
                      />
                    ) : (
                      <Icon icon={ICONS.IMAGE} />
                    )}
                  </div>
                </div>
              </div>
            )}
            {(assetName === 'Cover Image' || assetName === 'Thumbnail') && (
              <>
                {fileSelected && !isAnimated && (
                  <div className="tw:mt-app-s tw:flex tw:max-h-[350px] tw:items-center tw:justify-center tw:rounded-app tw:bg-app-text-inverse tw:p-app-xs tw:[line-height:0] tw:[outline:2px_solid_var(--color-border)]">
                    <ReactCrop
                      crop={crop}
                      onChange={(c: Crop) => setCrop(c)}
                      onComplete={(c: PixelCrop) => setCompletedCrop(c)}
                      aspect={assetName === 'Cover Image' ? 32 / 5 : 1}
                      circularCrop={assetName === 'Thumbnail'}
                      minWidth={assetName === 'Cover Image' ? (null as any) : 160}
                    >
                      <img
                        className="tw:max-h-[350px] tw:max-w-full tw:p-0"
                        ref={imgRef}
                        src={URL.createObjectURL(
                          new Blob([fileSelected], {
                            type: fileSelected.type,
                          })
                        )}
                        onLoad={!cropInit ? onImageLoad : () => {}}
                      />
                    </ReactCrop>
                  </div>
                )}
                <ChannelPreview />
              </>
            )}
          </>
        )}
      </fieldset-section>

      <div className={SELECT_ASSET_CLASSES.actions}>
        <FormField
          className="toggle-upload-checkbox"
          name="toggle-upload"
          type="checkbox"
          label={__('Use a URL')}
          checked={useUrl}
          onChange={() => setUseUrl(!useUrl)}
        />
        {onDone && (
          <Button
            button="primary"
            type="submit"
            label={useUrl ? __('Done') : __('Upload')}
            disabled={
              !useUrl && !!(uploadStatus === STATUS.UPLOADING || !pathSelected || !fileSelected || uploadErrorMsg)
            }
            onClick={() => {
              if (!useUrl) {
                doUploadAsset();
              } else if (useUrl && assetName === 'Image') {
                onUpdate(url, imageTitle);
              }
            }}
          />
        )}
      </div>
    </>
  );

  if (inline) {
    return <fieldset-section>{formBody}</fieldset-section>;
  }

  return (
    <Card // title={title || __('Choose %asset%', { asset: __(`${assetName}`) })}
      actions={<Form onSubmit={onDone}>{formBody}</Form>}
    />
  );
}

export default SelectAsset;
