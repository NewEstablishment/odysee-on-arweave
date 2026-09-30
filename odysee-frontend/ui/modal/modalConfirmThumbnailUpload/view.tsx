import React from 'react';
import { Modal } from 'modal/modal';
import { DOMAIN } from 'config';
import ThumbnailBrokenImage from 'component/selectThumbnail/thumbnail-broken.png';
import { useAppDispatch } from 'redux/hooks';
import { doHideModal } from 'redux/actions/app';
import { doUploadThumbnail, doUpdatePublishForm } from 'redux/actions/publish';
// ****************************************************************************
// ****************************************************************************
export type Props = {
  file: WebFile;
  cb: (arg0: string) => void;
  previewUrl?: string;
  onUploadStarted?: (arg0: string) => void;
  onUploadCanceled?: () => void;
};

// ****************************************************************************
// ****************************************************************************
function ModalConfirmThumbnailUpload(props: Props) {
  const { file, cb, previewUrl, onUploadStarted, onUploadCanceled } = props;
  const dispatch = useAppDispatch();
  const filePath = file && (file.path || file.name);
  const [imageSrc, setImageSrc] = React.useState('');
  const resolvedImageSrc = previewUrl || imageSrc;

  function handleConfirmed() {
    if (file) {
      dispatch(doUploadThumbnail('', file as any, null, null, file.path, cb));
      dispatch(
        doUpdatePublishForm({
          thumbnailPath: file.path,
        })
      );
      if (resolvedImageSrc) {
        onUploadStarted?.(resolvedImageSrc);
      }
      dispatch(doHideModal());
    }
  }

  React.useEffect(() => {
    if (previewUrl) {
      setImageSrc('');
      return;
    }

    const imgSrc = URL.createObjectURL(file as any);
    setImageSrc(imgSrc);
    return () => {
      if (imgSrc) {
        URL.revokeObjectURL(imgSrc);
      }
    };
  }, [file, previewUrl]);

  function handleAborted() {
    onUploadCanceled?.();
    dispatch(doHideModal());
  }

  return (
    <Modal
      isOpen
      title={__('Upload thumbnail')}
      contentLabel={__('Confirm Thumbnail Upload')}
      type="confirm"
      confirmButtonLabel={__('Upload')}
      onConfirmed={handleConfirmed}
      onAborted={handleAborted}
    >
      <label>
        {__('Are you sure you want to upload this thumbnail to %domain%', {
          domain: DOMAIN,
        })}
        ?
      </label>
      <div className="tw:my-app-s tw:flex tw:rounded-app tw:border tw:border-app-border tw:p-app-s tw:upto-small:flex-col">
        <img
          className="tw:h-[var(--thumbnail-preview-height)] tw:min-h-[var(--thumbnail-preview-height)] tw:w-[var(--thumbnail-preview-width)] tw:min-w-[var(--thumbnail-preview-width)] tw:rounded-app tw:border tw:border-app-border tw:bg-[var(--color-thumbnail-background)] tw:object-contain"
          src={resolvedImageSrc || ThumbnailBrokenImage}
          alt={__('Thumbnail Preview')}
          onError={() => setImageSrc('')}
        />
        <div className="tw:mt-app-s tw:ml-app-s tw:text-app-small tw:text-app-text-subtitle tw:upto-small:ml-0">
          {filePath}
        </div>
      </div>
    </Modal>
  );
}

export default ModalConfirmThumbnailUpload;
