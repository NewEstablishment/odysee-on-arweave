// import * as ICONS from 'constants/icons';
import React from 'react';
import I18nMessage from 'component/i18nMessage';
import { getThumbnailCdnUrl } from 'util/thumbnail';
type Props = {
  href?: string;
  image?: string;
  description?: string;
  text?: string;
};
const hubMessage = (text, href) => {
  return (
    <I18nMessage
      tokens={{
        help_hub: (
          <a rel="noopener noreferrer" href={href} target="_blank">
            {__('Help Hub')}
          </a>
        ),
      }}
    >
      {text}
    </I18nMessage>
  );
};

export default function HelpHub(props: Props) {
  const { href, image, text } = props;

  return (
    <div className="help-hub__wrapper">
      <span>{hubMessage(text, href)}</span>
      {image && (
        <img
          src={
            getThumbnailCdnUrl({
              thumbnail: `https://static.odycdn.com/images/helpHub_${image}.png`,
              width: 46,
              height: 0,
              quality: 95,
            }) || undefined
          }
        />
      )}
    </div>
  );
}
