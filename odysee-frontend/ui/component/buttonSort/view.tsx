import React from 'react';
import classnames from 'classnames';
type Props = {
  label: string;
  sortKey: string | null;
  ownKey: string;
  order: string | null;
  setKey: (key: string | null | undefined) => void;
  setOrder: (order: string | null | undefined) => void;
};
export default function (props: Props) {
  const { label, sortKey, ownKey, order, setKey, setOrder } = props;

  const onUpClick = () => {
    if (order !== 'asc' || sortKey !== ownKey) {
      setKey(ownKey);
      setOrder('asc');
    } else {
      setKey(null);
      setOrder(null);
    }
  };

  const onDownClick = () => {
    if (order !== 'desc' || sortKey !== ownKey) {
      setKey(ownKey);
      setOrder('desc');
    } else {
      setKey(null);
      setOrder(null);
    }
  };

  const upActive = order === 'asc' && sortKey === ownKey;
  const downActive = order === 'desc' && sortKey === ownKey;
  return (
    <th>
      <span className="tw:flex tw:items-center tw:gap-[4px]">
        {__(label)}
        <span className="tw:flex tw:flex-row tw:leading-none">
          <span
            className={classnames('tw:text-center tw:text-[16px] tw:opacity-50', {
              'tw:text-app-primary tw:opacity-100': upActive,
            })}
            onClick={() => onUpClick()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onDownClick();
            }}
          >
            &#9650;
          </span>
          <span
            className={classnames('tw:text-center tw:text-[16px] tw:opacity-50', {
              'tw:text-app-primary tw:opacity-100': downActive,
            })}
            onClick={() => onDownClick()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onDownClick();
            }}
          >
            &#9660;
          </span>
        </span>
      </span>
    </th>
  );
}
