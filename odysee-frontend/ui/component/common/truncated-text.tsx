import * as React from 'react';
import { TRUNCATED_TEXT_CLASS } from './truncated-text-classes';

type Props = {
  text: string | null | undefined;
  lines: number;
  showTooltip?: boolean;
  style?: any;
  emoji?: any;
};

const TruncatedText = ({ text, lines, showTooltip = true, style }: Props) => {
  const tooltip = showTooltip ? text : '';

  return (
    <span
      title={tooltip}
      className={TRUNCATED_TEXT_CLASS}
      style={{
        WebkitLineClamp: lines,
        ...style,
      }}
    >
      {text}
    </span>
  );
};

export default React.memo(TruncatedText);
