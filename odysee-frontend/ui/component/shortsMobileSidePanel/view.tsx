import * as React from 'react';
import { createPortal } from 'react-dom';
import classnames from 'classnames';
import { lazyImport } from 'util/lazyImport';
import * as ICONS from 'constants/icons';
import FileTitleSection from 'component/fileTitleSection';
import Empty from 'component/common/empty';
import Button from 'component/button';
import { lockBodyScroll, unlockBodyScroll } from 'util/body-scroll-lock';
import {
  SHORTS_MOBILE_PANEL_BACKDROP_CLASS,
  SHORTS_MOBILE_PANEL_BACKDROP_CLOSING_CLASS,
  SHORTS_MOBILE_PANEL_CLASS,
  SHORTS_MOBILE_PANEL_CLOSE_BUTTON_CLASS,
  SHORTS_MOBILE_PANEL_COMMENTS_CLASS,
  SHORTS_MOBILE_PANEL_CONTENT_CLASS,
  SHORTS_MOBILE_PANEL_DRAG_HANDLE_CLASS,
  SHORTS_MOBILE_PANEL_FILE_SECTION_CLASS,
  SHORTS_MOBILE_PANEL_HEADER_CLASS,
  SHORTS_MOBILE_PANEL_MODAL_CLASS,
  SHORTS_MOBILE_PANEL_MODAL_CLOSING_CLASS,
  SHORTS_MOBILE_PANEL_OPEN_CLASS,
  SHORTS_MOBILE_PANEL_TITLE_CLASS,
} from './classes';

const CommentsList = lazyImport(
  () =>
    import(
      'component/commentsList'
      /* webpackChunkName: "comments" */
    )
);

type Props = {
  isOpen: boolean;
  onClose: () => void;
  portalTarget?: Element;
  uri: string;
  accessStatus: string | null | undefined;
  contentUnlocked: boolean;
  commentsDisabled: boolean | null | undefined;
  linkedCommentId?: string;
  threadCommentId?: string;
  isComments?: boolean;
};

export default function MobilePanel(props: Props) {
  const {
    isOpen,
    onClose,
    portalTarget,
    uri,
    accessStatus,
    contentUnlocked,
    commentsDisabled,
    linkedCommentId,
    threadCommentId,
    isComments,
  } = props;
  const modalRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const commentsRef = React.useRef<HTMLDivElement | null>(null);
  const [isClosing, setIsClosing] = React.useState(false);
  const handleClose = React.useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 250);
  }, [onClose]);
  React.useEffect(() => {
    const handleEscape: any = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      lockBodyScroll();
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (isOpen) unlockBodyScroll();
    };
  }, [isOpen, handleClose]);

  const handleBackdropClick = (e) => {
    if (e.target === modalRef.current) {
      handleClose();
    }
  };

  React.useEffect(() => {
    if (!isOpen || !contentRef.current) return;

    const contentEl = contentRef.current;
    const raf = requestAnimationFrame(() => {
      if (isComments && commentsRef.current) {
        const contentRect = contentEl.getBoundingClientRect();
        const commentsRect = commentsRef.current.getBoundingClientRect();

        contentEl.scrollTo({
          top: commentsRect.top - contentRect.top + contentEl.scrollTop,
          behavior: 'smooth',
        });
      } else {
        contentEl.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [isComments, isOpen, uri, linkedCommentId, threadCommentId]);

  React.useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  if (!document.body) return null;
  return createPortal(
    <div
      className={classnames(SHORTS_MOBILE_PANEL_CLASS, {
        [SHORTS_MOBILE_PANEL_OPEN_CLASS]: isOpen,
      })}
    >
      {(isOpen || isClosing) && (
        <div
          className={classnames(SHORTS_MOBILE_PANEL_BACKDROP_CLASS, {
            [SHORTS_MOBILE_PANEL_BACKDROP_CLOSING_CLASS]: isClosing,
          })}
          ref={modalRef}
          onClick={handleBackdropClick}
        >
          <div
            className={classnames(SHORTS_MOBILE_PANEL_MODAL_CLASS, {
              [SHORTS_MOBILE_PANEL_MODAL_CLOSING_CLASS]: isClosing,
            })}
          >
            <div className={SHORTS_MOBILE_PANEL_HEADER_CLASS}>
              <div className={SHORTS_MOBILE_PANEL_DRAG_HANDLE_CLASS} />
              <div className={SHORTS_MOBILE_PANEL_TITLE_CLASS}>
                <div>{isComments ? __('Comments') : __('Video Details')}</div>
                <Button
                  className={SHORTS_MOBILE_PANEL_CLOSE_BUTTON_CLASS}
                  onClick={handleClose}
                  icon={ICONS.REMOVE}
                  iconSize={20}
                  title={__('Close')}
                />
              </div>
            </div>

            <div ref={contentRef} className={SHORTS_MOBILE_PANEL_CONTENT_CLASS}>
              <div className={SHORTS_MOBILE_PANEL_FILE_SECTION_CLASS}>
                <FileTitleSection uri={uri} accessStatus={accessStatus} />
              </div>

              <div ref={commentsRef} className={SHORTS_MOBILE_PANEL_COMMENTS_CLASS}>
                <h4>{__('Comments')}</h4>
                {contentUnlocked &&
                  (commentsDisabled ? (
                    <Empty padded text={__('The creator of this content has disabled comments.')} />
                  ) : (
                    <React.Suspense fallback={null}>
                      <CommentsList
                        uri={uri}
                        linkedCommentId={linkedCommentId}
                        threadCommentId={threadCommentId}
                        notInDrawer
                      />
                    </React.Suspense>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    portalTarget || document.body
  );
}
