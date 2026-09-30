import React from 'react';
import classnames from 'classnames';
import { Modal } from 'modal/modal';
import Button from 'component/button';
import * as ICONS from 'constants/icons';
import { useAppDispatch } from 'redux/hooks';
import { doHideModal } from 'redux/actions/app';
import { MODAL_VIEW_IMAGE_CLASSES as C } from './classes';

type Props = {
  src: string;
  title?: string;
};

export default function ModalViewImage(props: Props) {
  const { src, title } = props;
  const dispatch = useAppDispatch();
  const [zoomed, setZoomed] = React.useState(false);
  const closeModal = React.useCallback(() => dispatch(doHideModal()), [dispatch]);
  const toggleZoom = React.useCallback(() => setZoomed((value) => !value), []);
  const resolvedTitle = title || __('Image preview');

  return (
    <Modal className={C.root} onAborted={closeModal} isOpen type="custom">
      <div className={C.chrome}>
        <div className={C.title} title={resolvedTitle}>
          {resolvedTitle}
        </div>
        <div className={C.actions}>
          <Button
            button="link"
            href={src}
            navigateTarget="_blank"
            aria-label={__('Open original image')}
            label={__('Open original')}
            icon={ICONS.EXTERNAL}
            className={C.actionButton}
          />
          <Button
            button="link"
            aria-label={zoomed ? __('Fit image to screen') : __('Zoom image')}
            label={zoomed ? __('Fit to screen') : __('Zoom')}
            icon={zoomed ? ICONS.COMPACT : ICONS.EXPAND}
            onClick={toggleZoom}
            className={C.actionButton}
          />
          <Button
            button="close"
            aria-label={__('Close image')}
            icon={ICONS.REMOVE}
            onClick={closeModal}
            className={C.close}
          />
        </div>
      </div>
      <div className={classnames(C.viewport, zoomed && C.viewportZoomed)}>
        <img
          className={classnames(C.image, zoomed && C.imageZoomed)}
          src={src}
          alt={resolvedTitle}
          onClick={toggleZoom}
          title={zoomed ? __('Click to fit image to screen') : __('Click to zoom image')}
        />
      </div>
    </Modal>
  );
}
