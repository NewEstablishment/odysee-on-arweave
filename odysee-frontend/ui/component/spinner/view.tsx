import React, { useState, useEffect, useRef } from 'react';
import classnames from 'classnames';
import { DARK_THEME, LIGHT_THEME } from 'constants/themes';
import { useAppSelector } from 'redux/hooks';
import { selectTheme } from 'redux/selectors/settings';
import { SPINNER_CLASS, SPINNER_RECT_CLASSES, SPINNER_VARIANT_CLASSES } from './classes';

type Props = {
  dark?: boolean;
  light?: boolean;
  type?: string | null;
  delayed?: boolean;
  text?: any;
};

const Spinner = React.memo(function Spinner({ dark = false, light = false, type, delayed = false, text }: Props) {
  const theme = useAppSelector((state) => selectTheme(state));

  const [show, setShow] = useState(!delayed);
  const delayedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (delayed) {
      delayedTimeoutRef.current = setTimeout(() => {
        setShow(true);
      }, 750);
    }

    return () => {
      if (delayedTimeoutRef.current) {
        clearTimeout(delayedTimeoutRef.current);
        delayedTimeoutRef.current = null;
      }
    };
  }, [delayed]);

  if (!show) {
    return null;
  }

  return (
    <>
      {text}
      <div
        className={classnames(SPINNER_CLASS, {
          [SPINNER_VARIANT_CLASSES.dark]: !light && (dark || theme === LIGHT_THEME),
          [SPINNER_VARIANT_CLASSES.light]: !dark && (light || theme === DARK_THEME),
          [SPINNER_VARIANT_CLASSES.small]: type === 'small',
        })}
      >
        {SPINNER_RECT_CLASSES.map((className) => (
          <div className={className} key={className} />
        ))}
      </div>
    </>
  );
});

export default Spinner;
