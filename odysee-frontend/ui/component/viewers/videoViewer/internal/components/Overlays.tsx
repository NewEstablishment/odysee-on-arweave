import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OVERLAY_CLASSES } from './overlay-classes';

const OVERLAY_DURATION_MS = 800;

let overlayIdCounter = 0;

export function useOverlay() {
  const [overlay, setOverlay] = useState(null);
  const timerRef = useRef(null);

  const showOverlay = useCallback((content) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = ++overlayIdCounter;
    setOverlay({ content, id });
    timerRef.current = setTimeout(() => {
      setOverlay(null);
    }, OVERLAY_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { overlay, showOverlay };
}

export default function Overlays({ overlay }) {
  if (!overlay) return null;

  return (
    <div className={OVERLAY_CLASSES.root} key={overlay.id}>
      <div className={OVERLAY_CLASSES.content}>{overlay.content}</div>
    </div>
  );
}
