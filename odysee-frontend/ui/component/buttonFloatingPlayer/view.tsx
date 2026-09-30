import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { BUTTON_ALT_CLASS, BUTTON_CLASS, BUTTON_CONTENT_CLASS, BUTTON_LABEL_CLASS } from 'component/button/classes';
import { FILE_ACTION_BUTTON_CLASS } from 'component/common/file-action-button-classes';
import { useAppDispatch } from 'redux/hooks';
import { doStartFloatingPlayingUri } from 'redux/actions/content';
import { doResolveUri } from 'redux/actions/claims';
import { doFileGetForUri } from 'redux/actions/file';

function ButtonFloatingPlayer(props: { uri: string; focusable?: boolean }) {
  const { uri, focusable = true } = props;
  const dispatch = useAppDispatch();

  function handleClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    dispatch(doResolveUri(uri, false) as any);
    dispatch(doFileGetForUri(uri));
    dispatch(doStartFloatingPlayingUri({ uri }));
  }

  return (
    <div className="claim-preview__hover-actions tw:col-start-2 tw:row-start-3">
      <button
        title={__('Floating Player')}
        aria-label={__('Floating Player')}
        className={`${BUTTON_CLASS} ${BUTTON_ALT_CLASS} ${FILE_ACTION_BUTTON_CLASS}`}
        onClick={handleClick}
        tabIndex={focusable ? 0 : -1}
        type="button"
      >
        <span className={BUTTON_CONTENT_CLASS}>
          <Icon icon={ICONS.FLOATING_PLAYER} />
          <span dir="auto" className={BUTTON_LABEL_CLASS}>
            {__('Floating Player')}
          </span>
        </span>
      </button>
    </div>
  );
}

export default ButtonFloatingPlayer;
