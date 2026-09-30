import React from 'react';
import classnames from 'classnames';
import Spinner from 'component/spinner';
import { VideoRenderFloatingContext } from 'contexts/videoRenderFloating';
import { LOADING_SCREEN_CLASSES } from './loading-screen-classes';
type Props = {
  status?: string;
  spinner?: boolean;
  transparent?: boolean;
};

const LoadingScreen = (props: Props) => {
  const { status, spinner = true, transparent } = props;
  const floatingContext = React.useContext(VideoRenderFloatingContext);
  return (
    <div
      className={classnames(LOADING_SCREEN_CLASSES.base, {
        [LOADING_SCREEN_CLASSES.transparent]: transparent,
        [LOADING_SCREEN_CLASSES.draggable]: floatingContext?.draggable,
      })}
      data-loading-screen
    >
      {spinner && <Spinner light={!transparent} delayed={!transparent} text={status} />}
    </div>
  );
};

export default LoadingScreen;
