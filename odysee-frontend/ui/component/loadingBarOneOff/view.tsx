import * as React from 'react';
import LoadingBar from 'react-top-loading-bar';

function LoadingBarOneOff(props: any) {
  const loadingBarRef = React.useRef(null);
  React.useEffect(() => {
    if (loadingBarRef.current) {
      loadingBarRef.current.continuousStart();
    }
  }, []);
  return <LoadingBar className="tw:![background-image:var(--color-odysee-gradient)]" ref={loadingBarRef} />;
}

export default LoadingBarOneOff;
