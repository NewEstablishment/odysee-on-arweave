/* eslint-disable react/prop-types */
import React, { useCallback, useEffect } from 'react';
import { KEYBOARD_SHORTCUT_CLASSES } from './keyboard-shortcuts-classes';

const PRIMARY_SHORTCUTS = [
  { keys: ['Space', 'K'], label: __('Play/Pause (hold to speed up)') },
  { keys: ['J', 'L'], label: __('Seek -10s / +10s') },
  { keys: ['Left', 'Right'], label: __('Seek -5s / +5s') },
  { keys: ['Up', 'Down'], label: __('Volume up/down') },
  { keys: 'M', label: __('Mute/unmute') },
  { keys: 'F', label: __('Fullscreen') },
];

const SECONDARY_SHORTCUTS = [
  { keys: ['Shift', '?'], separator: ' + ', label: __('Show shortcuts') },
  { keys: ['Shift', '.'], separator: ' + ', label: __('Speed up') },
  { keys: ['Shift', ','], separator: ' + ', label: __('Slow down') },
  { keys: '0-9', label: __('Jump to 0-90%') },
  { keys: 'T', label: __('Theater mode') },
  { keys: ['Shift', 'N'], separator: ' + ', label: __('Play next') },
  { keys: ['Shift', 'P'], separator: ' + ', label: __('Play previous') },
  { keys: ',', label: __('Back one frame (paused)') },
  { keys: '.', label: __('Forward one frame (paused)') },
];

function ShortcutItem({ keys, separator, label }: { keys: any; separator?: any; label: any }) {
  const parts = Array.isArray(keys) ? keys : [keys];
  const joiner = separator || ' / ';

  return (
    <li className={KEYBOARD_SHORTCUT_CLASSES.item}>
      <span className={KEYBOARD_SHORTCUT_CLASSES.keys}>
        {parts.map((key, i) => (
          <React.Fragment key={key}>
            {i > 0 && <span className={KEYBOARD_SHORTCUT_CLASSES.separator}>{joiner}</span>}
            <kbd className={KEYBOARD_SHORTCUT_CLASSES.kbd}>{key}</kbd>
          </React.Fragment>
        ))}
      </span>
      <span className={KEYBOARD_SHORTCUT_CLASSES.action}>{label}</span>
    </li>
  );
}

export default function KeyboardShortcutsOverlay({ onClose }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className={KEYBOARD_SHORTCUT_CLASSES.overlay}
      role="dialog"
      aria-label={__('Keyboard shortcuts')}
      onClick={onClose}
    >
      <div className={KEYBOARD_SHORTCUT_CLASSES.card} onClick={(e) => e.stopPropagation()}>
        <div className={KEYBOARD_SHORTCUT_CLASSES.header}>
          <span className={KEYBOARD_SHORTCUT_CLASSES.title}>{__('Keyboard shortcuts')}</span>
          <button type="button" className={KEYBOARD_SHORTCUT_CLASSES.close} onClick={onClose}>
            {__('Close')}
          </button>
        </div>
        <div className={KEYBOARD_SHORTCUT_CLASSES.body}>
          <ul className={KEYBOARD_SHORTCUT_CLASSES.list}>
            {PRIMARY_SHORTCUTS.map((s) => (
              <ShortcutItem key={s.label} {...s} />
            ))}
          </ul>
          <ul className={KEYBOARD_SHORTCUT_CLASSES.list}>
            {SECONDARY_SHORTCUTS.map((s) => (
              <ShortcutItem key={s.label} {...s} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
