import * as ICONS from 'constants/icons';
import React from 'react';
import Button from 'component/button';
import { ICON_HELP_CLASS } from './icon-classes';
type Props = {
  href?: string;
  navigate?: string;
  icon?: string;
  iconSize?: number;
  description?: string;
};
export default function HelpLink(props: Props) {
  const { href, navigate, icon, iconSize, description } = props;
  return (
    <Button
      onClick={(e) => {
        if (href) {
          e.stopPropagation();
        }
      }}
      className={ICON_HELP_CLASS}
      icon={icon || ICONS.HELP}
      iconSize={iconSize || 14}
      title={description || __('Help')}
      description={description || __('Help')}
      href={href}
      navigate={navigate}
    />
  );
}
