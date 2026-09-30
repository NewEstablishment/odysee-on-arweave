import React from 'react';
import classnames from 'classnames';
import { EMPTY_CLASSES } from './empty-classes';

type Props = {
  text: string;
  padded?: boolean;
};
export default function Empty(props: Props) {
  const { text = '', padded = false } = props;
  return (
    <div
      className={classnames(EMPTY_CLASSES.wrap, {
        [EMPTY_CLASSES.padded]: padded,
      })}
    >
      <div>
        {text && (
          <div className={EMPTY_CLASSES.content}>
            <p className="tw:text-[var(--color-text-empty)] tw:italic">{text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
