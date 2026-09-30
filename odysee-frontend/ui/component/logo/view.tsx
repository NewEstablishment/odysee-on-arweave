import { useIsMobile } from 'effects/use-screensize';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import React from 'react';
import { useAppSelector } from 'redux/hooks';
import { selectTheme } from 'redux/selectors/settings';
import { EMBED_OVERLAY_LOGO_CLASS, HEADER_LOGO_CLASS } from './classes';

type Props = {
  type?: string;
};
export default function Logo(props: Props) {
  const { type } = props;

  const currentTheme = useAppSelector(selectTheme);
  const isMobile = useIsMobile();
  const isLightTheme = currentTheme === 'light';

  if (type === 'embed' || type === 'embed-ended') {
    return <Icon className={EMBED_OVERLAY_LOGO_CLASS} data-embed-overlay-logo icon={ICONS.ODYSEE_WHITE_TEXT} />;
  }

  if (type === 'small' || isMobile) {
    return <Icon className={HEADER_LOGO_CLASS} data-header-logo icon={ICONS.ODYSEE_LOGO} />;
  }

  return (
    <Icon
      className={HEADER_LOGO_CLASS}
      data-header-logo
      icon={isLightTheme ? ICONS.ODYSEE_DARK_TEXT : ICONS.ODYSEE_WHITE_TEXT}
    />
  );
}
