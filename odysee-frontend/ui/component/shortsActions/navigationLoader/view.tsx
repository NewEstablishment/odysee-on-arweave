import React from 'react';
import classnames from 'classnames';
type Props = {
  className?: string;
  size?: 'small' | 'medium' | 'large';
};

const NavigationLoader = (props: Props) => {
  const { className, size = 'medium' } = props;
  const dotSize = size === 'small' ? 'tw:size-[6px]' : size === 'large' ? 'tw:size-[10px]' : 'tw:size-[8px]';
  const gap = size === 'small' ? 'tw:gap-[6px]' : size === 'large' ? 'tw:gap-[10px]' : 'tw:gap-[8px]';
  const animation = className?.includes('vertical-loader--fade')
    ? 'tw:[animation:vertical-fade_1.2s_ease-in-out_infinite]'
    : 'tw:[animation:vertical-pulse_1.2s_ease-in-out_infinite]';
  return (
    <div
      className={classnames(
        'tw:mt-[15px] tw:mr-[20px] tw:flex tw:flex-col tw:items-center tw:justify-center',
        gap,
        className
      )}
    >
      {[0, 0.2, 0.4].map((delay) => (
        <span
          className={classnames(
            'navigation-loader-dot tw:rounded-[50%] tw:bg-[var(--color-primary,#000)] tw:opacity-30',
            animation,
            dotSize
          )}
          key={delay}
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
};

export default NavigationLoader;
