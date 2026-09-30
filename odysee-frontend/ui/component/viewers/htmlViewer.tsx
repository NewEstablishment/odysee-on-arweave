import React, { useRef, useState, useEffect } from 'react';
import { HTML_VIEWER_PLACEHOLDER_CLASS } from './html-viewer-classes';
import { FILE_VIEWER_CLASSES } from './classes';
type Props = {
  source: string;
};

function HtmlViewer({ source }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = iframe.current;
    if (!el) return;

    const onLoad = () => {
      setLoading(false);
      const { scrollHeight, scrollWidth } = el.contentDocument.body;
      el.style.height = `${scrollHeight}px`;
      el.style.width = `${scrollWidth}px`;
    };

    el.addEventListener('load', onLoad);
    (el as any).resize = () => {
      const { scrollHeight, scrollWidth } = el.contentDocument.body;
      el.style.height = `${scrollHeight}px`;
      el.style.width = `${scrollWidth}px`;
    };

    return () => el.removeEventListener('load', onLoad);
  }, []);

  return (
    <div className={`${FILE_VIEWER_CLASSES.base} file-viewer--html ${FILE_VIEWER_CLASSES.iframe}`} data-file-viewer>
      {loading && <div className={HTML_VIEWER_PLACEHOLDER_CLASS} />}
      <iframe ref={iframe} hidden={loading} sandbox="" title={__('File preview')} src={source} />
    </div>
  );
}

export default HtmlViewer;
