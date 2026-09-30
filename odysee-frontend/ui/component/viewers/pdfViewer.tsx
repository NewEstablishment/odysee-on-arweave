import React from 'react';
import IframeReact from 'component/IframeReact';
import { FILE_VIEWER_CLASSES } from './classes';
type Props = {
  source: string;
};

function PdfViewer({ source }: Props) {
  const src = IS_WEB ? source : `file://${source}`;
  return (
    <div
      className={`${FILE_VIEWER_CLASSES.base} ${FILE_VIEWER_CLASSES.document}`}
      data-file-viewer
      data-file-viewer-document
    >
      <div className={`${FILE_VIEWER_CLASSES.base} ${FILE_VIEWER_CLASSES.iframe}`} data-file-viewer>
        <IframeReact title={__('File preview')} src={src} />
      </div>
    </div>
  );
}

export default PdfViewer;
