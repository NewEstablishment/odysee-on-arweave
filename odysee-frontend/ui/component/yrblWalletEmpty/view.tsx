import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import React from 'react';
import Button from 'component/button';
import Yrbl from 'component/yrbl';
import I18nMessage from 'component/i18nMessage';
import LbcSymbol from 'component/common/lbc-symbol';
import { SECTION_CLASSES } from 'component/common/section-classes';
type Props = {
  includeWalletLink?: boolean;
  type?: string;
  actions?: React.ReactNode;
};
export default function YrblWalletEmpty(props: Props) {
  const { includeWalletLink = false, type = 'sad' } = props;
  return (
    <div className={PAGE_MAIN_EMPTY_CLASS}>
      <Yrbl
        type={type}
        title={__('Your wallet is empty')}
        subtitle={
          <div>
            <p>
              <I18nMessage
                tokens={{
                  lbc: <LbcSymbol />,
                }}
              >
                You need %lbc% to create a channel and upload content.
              </I18nMessage>
            </p>
            <p>
              <I18nMessage
                tokens={{
                  lbc: <LbcSymbol />,
                }}
              >
                Never fear though, there are tons of ways to receive %lbc%, and if that doesn't work, you can just ask
                us at hello@odysee.com
              </I18nMessage>
            </p>
          </div>
        }
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button
              button="primary"
              icon={ICONS.REWARDS}
              label={__('Receive Credits')}
              navigate={`/$/${PAGES.REWARDS}`}
            />
            {includeWalletLink && (
              <Button
                icon={ICONS.RECEIVE}
                button="secondary"
                label={__('Your Address')}
                navigate={`/$/${PAGES.RECEIVE}`}
              />
            )}
          </div>
        }
      />
    </div>
  );
}
