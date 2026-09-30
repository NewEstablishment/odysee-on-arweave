import Button from 'component/button';
import React from 'react';
import ChannelThumbnail from 'component/channelThumbnail';
import UriIndicator from 'component/uriIndicator';
import CreditAmount from 'component/common/credit-amount';
import { TAB_USD } from 'constants/tip_tabs';
import { COMMENT_CREATE_CLASSES } from '../classes';
type Props = {
  activeChannelUrl: string;
  tipAmount: number;
  activeTab: string;
  message: string;
  isReviewingStickerComment?: boolean;
  stickerPreviewComponent?: any;
};
export const TipReviewBox = (props: Props) => {
  const { activeChannelUrl, tipAmount, activeTab, message, isReviewingStickerComment, stickerPreviewComponent } = props;
  return (
    <div className={COMMENT_CREATE_CLASSES.supportPreview}>
      <CreditAmount
        amount={tipAmount}
        className={COMMENT_CREATE_CLASSES.supportPreviewAmount}
        isFiat={activeTab === TAB_USD}
        size={2}
      />

      {isReviewingStickerComment ? (
        stickerPreviewComponent
      ) : (
        <>
          <ChannelThumbnail xsmall uri={activeChannelUrl} />

          <div>
            <UriIndicator uri={activeChannelUrl} link showAtSign />
            <div>{message}</div>
          </div>
        </>
      )}
    </div>
  );
};
type TipButtonProps = {
  name: string;
  tab: string;
  activeTab?: string;
  tipSelectorOpen?: boolean;
  onClick: (tab: string) => void;
  [key: string]: any;
};
export const TipActionButton = (tipButtonProps: TipButtonProps) => {
  const { name, tab, activeTab, tipSelectorOpen, onClick, ...buttonProps } = tipButtonProps;
  return (
    (!tipSelectorOpen || activeTab !== tab) && (
      <Button {...buttonProps} title={name} label={tipSelectorOpen ? name : undefined} onClick={() => onClick(tab)} />
    )
  );
};
