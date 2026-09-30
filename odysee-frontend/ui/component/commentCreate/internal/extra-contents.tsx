import { ERROR_TEXT_CLASS } from 'component/common/error-classes';
import React from 'react';
import * as ICONS from 'constants/icons';
import CreditAmount from 'component/common/credit-amount';
import I18nMessage from 'component/i18nMessage';
import Icon from 'component/common/icon';
import { ICON_HELP_CLASS } from 'component/common/icon-classes';
import SelectChannel from 'component/selectChannel';
import { COMMENT_CREATE_CLASSES } from '../classes';
type SelectorProps = {
  isReply: boolean;
  isLivestream: boolean;
};
export const FormChannelSelector = (selectorProps: SelectorProps) => {
  const { isReply, isLivestream } = selectorProps;
  return (
    <div className={COMMENT_CREATE_CLASSES.labelWrapper}>
      <span className={COMMENT_CREATE_CLASSES.label}>
        {(isReply ? __('Replying as') : isLivestream ? __('Chat as') : __('Comment as')) + ' '}
      </span>

      <SelectChannel tiny />
    </div>
  );
};
type HelpTextProps = {
  deletedComment: boolean;
  minAmount: number;
  minTip: number;
  minSuper: number;
  minUSDAmount: number;
  minUSDSuper: number;
  minUSDTip: number;
};
export const HelpText = (helpTextProps: HelpTextProps) => {
  const { deletedComment, minAmount, minTip, minSuper, minUSDAmount, minUSDSuper, minUSDTip } = helpTextProps;
  return (
    <>
      {deletedComment && <div className={ERROR_TEXT_CLASS}>{__('This comment has been deleted.')}</div>}

      {(!!minAmount || !!minUSDAmount) && (
        <div className={COMMENT_CREATE_CLASSES.minAmount}>
          <span>{!!minTip || !!minUSDTip ? __('Comment minimum: ') : __('HyperChat minimum: ')}</span>
          {(!!minTip || !!minSuper || !!minUSDTip || !!minUSDSuper) && (
            <>
              <I18nMessage
                tokens={{
                  usd: <CreditAmount noFormat isFiat amount={minUSDAmount || 0.01} />,
                }}
              >
                {`%usd%`}
              </I18nMessage>
            </>
          )}

          <Icon
            customTooltipText={
              minTip || minUSDTip
                ? __('This channel requires a minimum tip for each comment.')
                : minSuper || minUSDSuper
                  ? __('This channel requires a minimum amount for HyperChats to be visible.')
                  : ''
            }
            className={ICON_HELP_CLASS}
            icon={ICONS.HELP}
            tooltip
            size={16}
          />
        </div>
      )}
    </>
  );
};
