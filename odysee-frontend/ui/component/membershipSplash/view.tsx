import React from 'react';
import classnames from 'classnames';
import * as ICONS from 'constants/icons';
import * as MEMBERSHIP_CONSTS from 'constants/memberships';
import Icon from 'component/common/icon';
import I18nMessage from 'component/i18nMessage';
import AstronautAndFriends from './internal/assets/astronaut_n_friends.png';
import BadgePremium from './internal/assets/badge_premium.png';
import BadgePremiumPlus from './internal/assets/badge_premium-plus.png';
import OdyseePremium from './internal/assets/odysee_premium.png';
import JoinButton from './internal/joinPlanButton';
import { useAppSelector } from 'redux/hooks';
import { selectPreferredCurrency } from 'redux/selectors/settings';
import { MEMBERSHIP_SPLASH_CLASSES } from './classes';
type Props = {
  pageLocation?: string;
  uri?: string;
  claimIsMine?: boolean;
  onCancel?: () => void;
};

const MembershipSplash = (props: Props) => {
  const { pageLocation } = props;
  const preferredCurrency = useAppSelector(selectPreferredCurrency);
  return (
    <div className={MEMBERSHIP_SPLASH_CLASSES.root}>
      <div className={MEMBERSHIP_SPLASH_CLASSES.banner}>
        <img className={MEMBERSHIP_SPLASH_CLASSES.bannerImage} width="1000" height="740" src={AstronautAndFriends} />

        <section className={MEMBERSHIP_SPLASH_CLASSES.title}>
          <section className={MEMBERSHIP_SPLASH_CLASSES.logoSection}>
            <img className={MEMBERSHIP_SPLASH_CLASSES.logo} width="1000" height="174" src={OdyseePremium} />
          </section>

          <section>
            <I18nMessage
              tokens={{
                early_access: <b className={MEMBERSHIP_SPLASH_CLASSES.titleStrong}>{__('early access')}</b>,
                site_wide_badge: <b className={MEMBERSHIP_SPLASH_CLASSES.titleStrong}>{__('site-wide badge')}</b>,
              }}
            >
              Get %early_access% features and a %site_wide_badge%
            </I18nMessage>
          </section>
        </section>
      </div>

      <div className={MEMBERSHIP_SPLASH_CLASSES.infoWrapper}>
        <div className={classnames(MEMBERSHIP_SPLASH_CLASSES.info, MEMBERSHIP_SPLASH_CLASSES.introInfo)}>
          <h1 className={MEMBERSHIP_SPLASH_CLASSES.introTitle}>
            <I18nMessage>
              "Creating a revolutionary video platform for everyone is something we're proud to be doing, but it isn't
              something that can happen without support. If you believe in Odysee's mission, please consider becoming a
              Premium member. As a Premium member, you'll be helping us build the best platform in the universe and
              we'll give you some cool perks!"
            </I18nMessage>
          </h1>
        </div>

        <div className={classnames(MEMBERSHIP_SPLASH_CLASSES.info, MEMBERSHIP_SPLASH_CLASSES.premiumInfo)}>
          <section
            className={classnames(MEMBERSHIP_SPLASH_CLASSES.infoHeader, MEMBERSHIP_SPLASH_CLASSES.premiumHeader)}
          >
            <div className={MEMBERSHIP_SPLASH_CLASSES.infoPrice}>
              <img className={MEMBERSHIP_SPLASH_CLASSES.infoPriceImage} width="500" height="500" src={BadgePremium} />

              <section className={MEMBERSHIP_SPLASH_CLASSES.infoPriceValue}>
                <I18nMessage
                  tokens={{
                    premium_recurrence: <div className={MEMBERSHIP_SPLASH_CLASSES.infoRange}>{__('A MONTH')}</div>,
                    premium_price:
                      MEMBERSHIP_CONSTS.PRICES[MEMBERSHIP_CONSTS.ODYSEE_TIER_NAMES.PREMIUM][preferredCurrency],
                  }}
                >
                  %premium_price% %premium_recurrence% --[context: '99¢ A MONTH']--
                </I18nMessage>
              </section>
            </div>
          </section>

          <BadgeInfo />

          <EarlyAcessInfo />

          <div className={MEMBERSHIP_SPLASH_CLASSES.infoButton}>
            <JoinButton pageLocation={pageLocation} interval="year" plan="Premium" doOpenModal />
          </div>
        </div>

        <div className={classnames(MEMBERSHIP_SPLASH_CLASSES.info, MEMBERSHIP_SPLASH_CLASSES.premiumPlusInfo)}>
          <section
            className={classnames(MEMBERSHIP_SPLASH_CLASSES.infoHeader, MEMBERSHIP_SPLASH_CLASSES.premiumPlusHeader)}
          >
            <div className={MEMBERSHIP_SPLASH_CLASSES.infoPrice}>
              <img
                className={MEMBERSHIP_SPLASH_CLASSES.infoPriceImage}
                width="500"
                height="500"
                src={BadgePremiumPlus}
              />

              <section className={MEMBERSHIP_SPLASH_CLASSES.infoPriceValue}>
                <I18nMessage
                  tokens={{
                    premium_recurrence: <div className={MEMBERSHIP_SPLASH_CLASSES.infoRange}>{__('A MONTH')}</div>,
                    premium_price:
                      MEMBERSHIP_CONSTS.PRICES[MEMBERSHIP_CONSTS.ODYSEE_TIER_NAMES.PREMIUM_PLUS][preferredCurrency],
                  }}
                >
                  %premium_price% %premium_recurrence% --[context: '99¢ A MONTH']--
                </I18nMessage>
              </section>
            </div>
          </section>

          <BadgeInfo />
          <EarlyAcessInfo />

          <div className={MEMBERSHIP_SPLASH_CLASSES.infoButton}>
            <JoinButton pageLocation={pageLocation} interval="year" plan="Premium%2b" doOpenModal />
          </div>
        </div>
      </div>
    </div>
  );
};

const EarlyAcessInfo = () => (
  <div className={MEMBERSHIP_SPLASH_CLASSES.infoContent}>
    <Icon className={MEMBERSHIP_SPLASH_CLASSES.infoContentIcon} icon={ICONS.EARLY_ACCESS} />
    <h1 className={MEMBERSHIP_SPLASH_CLASSES.infoContentTitle}>{__('Exclusive and early access to features')}</h1>
  </div>
);

const BadgeInfo = () => (
  <div className={MEMBERSHIP_SPLASH_CLASSES.infoContent}>
    <Icon className={MEMBERSHIP_SPLASH_CLASSES.infoContentIcon} icon={ICONS.MEMBER_BADGE} />
    <h1 className={MEMBERSHIP_SPLASH_CLASSES.infoContentTitle}>{__('Badge on profile')}</h1>
  </div>
);

export default MembershipSplash;
