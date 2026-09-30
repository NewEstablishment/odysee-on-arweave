import * as ICONS from 'constants/icons';
import React from 'react';
import classnames from 'classnames';
import { icons } from './icon-custom';
import { ICON_NAME_CLASSES, ICON_WRAPPER_CLASS, ICON_WRAPPER_NAME_CLASSES } from './icon-classes';
// It would be nice to standardize this somehow
// Keep these names aligned with the semantic icon tokens in ui/styles/tokens.css.
const RED_COLOR = '#e2495e';
const GREEN_COLOR = '#44b098';
const BLUE_COLOR = '#49b2e2';
type Props = {
  icon: string;
  tooltip?: boolean;
  customTooltipText?: string;
  iconColor?: string;
  size?: number;
  className?: string;
  sectionIcon?: boolean;
  [key: string]: any;
};

function getTooltip(icon: string) {
  switch (icon) {
    case ICONS.REWARDS:
      return __('Featured content. Receive credits for watching.');
    case ICONS.DOWNLOAD:
      return __('This file is in your library.');
    case ICONS.SUBSCRIBE:
      return __('You are subscribed to this channel.');
    case ICONS.SETTINGS:
      return __('Your settings.');
    default:
      return null;
  }
}

function getIconColor(color: string) {
  switch (color) {
    case 'red':
      return RED_COLOR;
    case 'green':
      return GREEN_COLOR;
    case 'blue':
      return BLUE_COLOR;
    default:
      return color;
  }
}

function IconComponent({
  icon,
  tooltip,
  customTooltipText,
  iconColor,
  size,
  className,
  sectionIcon = false,
  ...rest
}: Props) {
  const Icon = icons[icon];

  if (!Icon) {
    return null;
  }

  const color = iconColor ? getIconColor(iconColor) : undefined;
  const tooltipText = tooltip ? customTooltipText || getTooltip(icon) : undefined;

  const component = (
    <Icon
      title={tooltipText}
      size={size || (sectionIcon ? 20 : 16)}
      className={classnames(`icon icon--${icon}`, ICON_NAME_CLASSES[icon], className)}
      color={color}
      aria-hidden
      {...rest}
    />
  );
  return sectionIcon ? (
    <span className={classnames(ICON_WRAPPER_CLASS, `icon__wrapper--${icon}`, ICON_WRAPPER_NAME_CLASSES[icon])}>
      {component}
    </span>
  ) : (
    component
  );
}

export default IconComponent;
