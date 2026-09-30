import React from 'react';
import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import Icon from 'component/common/icon';
import { BUTTON_CONTENT_CLASS } from 'component/button/classes';
import { FILE_VIEW_COUNT_CLASS } from 'component/fileViewCountInline/classes';
import { CLAIM_TILE_ABOUT_COUNTS_CLASS, CLAIM_TILE_HEADER_CLASS } from 'component/claimPreviewTile/classes';
import { CLAIM_PREVIEW_CHANNEL_STAKED_CLASS } from 'component/claimPreview/classes';
import { CLAIM_TILE_ABOUT_CLASS } from 'component/common/claim-grid-classes';
import { DATE_TIME_CLASS } from 'component/dateTime/classes';
type Props = {
  tileLayout?: boolean;
};

const PremiumPlusTile = (props: Props) => {
  const { tileLayout } = props;

  const title = __('Get a gold badge and access to exclusive features!');

  const channel = __('Get Odysee Premium+');

  const time = '';
  return tileLayout ? (
    <li className="card claim-preview--tile claim-preview--premium-plus">
      <a href={`/$/${PAGES.ODYSEE_MEMBERSHIP}`}>
        <div className="media__thumb" />
        <div className={CLAIM_TILE_HEADER_CLASS} data-claim-tile-header>
          <h2 className="claim-tile__title">{title}</h2>
        </div>
        <div>
          <div className="claim-tile__info">
            <Icon icon={ICONS.UPGRADE} />
            <div className={CLAIM_TILE_ABOUT_CLASS}>
              <div className="channel-name">{channel}</div>
              <div className={CLAIM_TILE_ABOUT_COUNTS_CLASS} data-claim-tile-about-counts>
                <span className={DATE_TIME_CLASS}>{time}</span>
              </div>
            </div>
          </div>
        </div>
      </a>
    </li>
  ) : (
    <li className="claim-preview__wrapper claim-preview__wrapper--row claim-preview--premium-plus">
      <div className="background" />
      <a href={`/$/${PAGES.ODYSEE_MEMBERSHIP}`}>
        <div className="claim-preview">
          <div className="media__thumb" />
          <div className="claim-preview__text">
            <div className="claim-preview-metadata">
              <div className="claim-preview-info">
                <div className="claim-preview__title">{title}</div>
              </div>
              <div className="claim-tile__info">
                <div className={CLAIM_PREVIEW_CHANNEL_STAKED_CLASS} data-claim-preview-channel-staked>
                  <Icon icon={ICONS.UPGRADE} />
                </div>
                <div className="media__subtitle">
                  <div className={BUTTON_CONTENT_CLASS}>
                    <span className="channel-name">{channel}</span>
                    <br />
                  </div>
                  <span className={FILE_VIEW_COUNT_CLASS}>{time}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </a>
    </li>
  );
};

export default PremiumPlusTile;
