import React from 'react';
import classnames from 'classnames';

type Props = {
  busy?: boolean | null | undefined;
  className?: string;
  status: boolean;
  setStatus?: () => void;
  tone?: 'address' | 'default';
};

function ButtonToggle(props: Props) {
  const { busy, className, status, setStatus, tone = 'default' } = props;
  const addressTone = tone === 'address';

  return (
    <div
      className={classnames(
        'tw:relative tw:h-[20px] tw:w-[40px] tw:rounded-[10px] tw:hover:cursor-pointer',
        status
          ? addressTone
            ? 'tw:bg-[#1e3024] tw:[background:color-mix(in_srgb,var(--color-text)_70%,#00932e_10%)]'
            : 'tw:bg-[#e3f3e8] tw:[background:color-mix(in_srgb,white_80%,#00932e_10%)]'
          : addressTone
            ? 'tw:bg-[#301e1e] tw:[background:color-mix(in_srgb,var(--color-text)_70%,#930000_10%)]'
            : 'tw:bg-[#f3e3e3] tw:[background:color-mix(in_srgb,white_80%,#930000_10%)]',
        busy && 'tw:pointer-events-none tw:opacity-40',
        className
      )}
      onClick={() => setStatus()}
    >
      <div
        className={classnames(
          'tw:absolute tw:top-0 tw:size-[20px] tw:rounded-[50%] tw:transition-[left] tw:duration-200 tw:ease-[ease]',
          status ? 'tw:left-[20px] tw:bg-[#00932e]' : 'tw:left-0 tw:bg-[#930000]'
        )}
      />
    </div>
  );
}

export default ButtonToggle;
