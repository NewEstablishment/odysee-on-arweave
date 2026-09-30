import React from 'react';
import { BUSY_INDICATOR_LOADER_CLASS } from './busy-indicator-classes';

type Props = {
  message?: string | null;
};

function BusyIndicator({ message = '' }: Props) {
  return (
    <span className="busy-indicator">
      {message} <span className={BUSY_INDICATOR_LOADER_CLASS} />
    </span>
  );
}

export default BusyIndicator;
