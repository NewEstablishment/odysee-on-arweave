import React from 'react';
import Card from 'component/common/card';
import ErrorText from 'component/common/error-text';
import ZoomableImage from 'component/zoomableImage';
import Tooltip from 'component/common/tooltip';
import { FILE_VIEWER_CLASSES } from './classes';
type Props = {
  source: string;
  title: string | null | undefined;
  onClick: () => void;
};

function ImageViewer(props: Props) {
  const { source, title, onClick } = props;
  const [loadingError, setLoadingError] = React.useState(false);

  return (
    <React.Fragment>
      {loadingError && (
        <Card
          title={__('Error displaying image')}
          actions={<ErrorText>There was an error displaying the image. You may still download it.</ErrorText>}
        />
      )}
      {!loadingError && (
        <div
          className={onClick ? `${FILE_VIEWER_CLASSES.base} ${FILE_VIEWER_CLASSES.download}` : FILE_VIEWER_CLASSES.base}
          data-file-viewer
        >
          {!onClick ? (
            <ZoomableImage
              src={source}
              onError={(e) => {
                setLoadingError(true);
              }}
            />
          ) : (
            <Tooltip title={title} arrow={false} followCursor enterDelay={100}>
              <img src={source} onError={() => setLoadingError(true)} onClick={onClick} />
            </Tooltip>
          )}
        </div>
      )}
    </React.Fragment>
  );
}

export default ImageViewer;
