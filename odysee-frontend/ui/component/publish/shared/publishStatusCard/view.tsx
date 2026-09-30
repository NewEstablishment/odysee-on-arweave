import React from 'react';
import {
  publishStatusActionClassName,
  publishStatusBodyClassName,
  publishStatusCardClassName,
  publishStatusCheckboxClassName,
  publishStatusDescriptionClassName,
  publishStatusHeaderClassName,
  publishStatusIconClassName,
  publishStatusTextClassName,
  publishStatusTitleClassName,
  type PublishStatusVariant,
} from './classes';

type Props = {
  variant: PublishStatusVariant;
  icon: React.ReactNode;
  title: string;
  description: string | React.ReactNode;
  checkboxLabel?: string;
  checked?: boolean;
  onCheck?: () => void;
  children?: React.ReactNode;
};

export default function PublishStatusCard(props: Props) {
  const { variant, icon, title, description, checkboxLabel, checked, onCheck, children } = props;

  return (
    <div className={publishStatusCardClassName}>
      <div className={publishStatusHeaderClassName}>
        <div className={publishStatusIconClassName(variant)}>{icon}</div>
        <div className={publishStatusTextClassName}>
          <h3 className={publishStatusTitleClassName}>{title}</h3>
          <p className={publishStatusDescriptionClassName}>{description}</p>
        </div>
        {checkboxLabel && onCheck && (
          <label className={publishStatusActionClassName(variant)}>
            <input
              className={publishStatusCheckboxClassName(variant)}
              type="checkbox"
              checked={checked}
              onChange={onCheck}
            />
            <span>{checkboxLabel}</span>
          </label>
        )}
      </div>
      {children && <div className={publishStatusBodyClassName}>{children}</div>}
    </div>
  );
}
