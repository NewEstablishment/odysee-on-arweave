import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import * as React from 'react';
import classnames from 'classnames';
import Button from 'component/button';
import Page from 'component/page';
import SettingAccount from 'component/settingAccount';
import SettingAppearance from 'component/settingAppearance';
import SettingContent from 'component/settingContent';
import SettingPlayer from 'component/settingPlayer';
import SettingSystem from 'component/settingSystem';
import SettingUnauthenticated from 'component/settingUnauthenticated';
import Spinner from 'component/spinner';
import Yrbl from 'component/yrbl';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doEnterSettingsPage, doExitSettingsPage } from 'redux/actions/settings';
import { selectDaemonSettings, selectLanguage } from 'redux/selectors/settings';
import { selectPrefsReady } from 'redux/selectors/sync';
import { selectUserAuthenticated } from 'redux/selectors/user';
import { CARD_CLASSES } from 'component/common/card-classes';
import { SECTION_CLASSES } from 'component/common/section-classes';

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const daemonSettings = useAppSelector(selectDaemonSettings);
  const isAuthenticated = useAppSelector(selectUserAuthenticated);
  const prefsReady = useAppSelector(selectPrefsReady);
  const language = useAppSelector(selectLanguage);

  React.useEffect(() => {
    dispatch(doEnterSettingsPage());
    return () => {
      dispatch(doExitSettingsPage());
    };
  }, [dispatch]);

  const noDaemonSettings = !daemonSettings || Object.keys(daemonSettings).length === 0;

  if (isAuthenticated && !prefsReady) {
    return (
      <Page
        noFooter
        settingsPage
        noSideNavigation
        backout={{
          title: __('Settings'),
          backLabel: __('Save'),
        }}
        className="card-stack"
      >
        <div className={PAGE_MAIN_EMPTY_CLASS}>
          <Spinner text={__('Please wait a bit, we are still getting your account ready.')} />
        </div>
      </Page>
    );
  }

  return (
    <Page
      noFooter
      settingsPage
      noSideNavigation
      backout={{
        title: __('Settings'),
        backLabel: __('Save'),
      }}
      className="card-stack"
      key={language}
    >
      {!isAuthenticated && IS_WEB && (
        <>
          <SettingUnauthenticated />
          <div className={PAGE_MAIN_EMPTY_CLASS}>
            <Yrbl
              type="happy"
              title={__('Sign up for full control')}
              subtitle={__('Unlock new buttons that change things.')}
              actions={
                <div className={SECTION_CLASSES.actions}>
                  <Button button="primary" icon={ICONS.SIGN_UP} label={__('Sign Up')} navigate={`/$/${PAGES.AUTH}`} />
                </div>
              }
            />
          </div>
        </>
      )}

      {!IS_WEB && noDaemonSettings ? (
        <section className={`card ${CARD_CLASSES.section}`}>
          <div className={`card__title ${CARD_CLASSES.titleDeprecated}`}>{__('Failed to load settings.')}</div>
        </section>
      ) : (
        <div
          className={classnames('card-stack', {
            [CARD_CLASSES.disabled]: IS_WEB && !isAuthenticated,
          })}
        >
          <SettingAppearance />
          <SettingAccount />
          <SettingContent />
          <SettingPlayer />
          <SettingSystem />
        </div>
      )}
    </Page>
  );
}
