import React from 'react';
import Button from 'component/button';
import I18nMessage from 'component/i18nMessage';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { useAppSelector } from 'redux/hooks';
import { makeSelectNsfwCountFromUris, makeSelectOmittedCountForChannel } from 'redux/selectors/claims';
import { parseURI } from 'util/lbryURI';
import { selectShowMatureContent } from 'redux/selectors/settings';
import { SECTION_CLASSES } from 'component/common/section-classes';

type Props = {
  uri?: string;
  uris?: Array<string>;
  className: string | null | undefined;
  mature?: boolean;
};
export default function HiddenNsfwClaims(props: Props) {
  const { uri, uris, mature } = props;

  const numberOfHiddenClaims = useAppSelector((state) => {
    if (uri) {
      const { isChannel } = parseURI(uri);
      return isChannel ? makeSelectOmittedCountForChannel(uri)(state) : makeSelectNsfwCountFromUris([uri])(state);
    } else if (uris) {
      return makeSelectNsfwCountFromUris(uris)(state);
    }
    return undefined;
  });
  const obscureNsfw = useAppSelector((state) => !selectShowMatureContent(state));

  const number = numberOfHiddenClaims;
  return (
    obscureNsfw && (
      <>
        {number ? (
          <div className={`${SECTION_CLASSES.padded} ${SECTION_CLASSES.subtitle}`}>
            <I18nMessage
              tokens={{
                content_viewing_preferences_link: (
                  <Button button="link" navigate="/$/settings" label={__('content viewing preferences')} />
                ),
                number: number,
              }}
            >
              {number > 1
                ? '%number% files hidden due to your %content_viewing_preferences_link%'
                : '1 file hidden due to your %content_viewing_preferences_link%'}
            </I18nMessage>
          </div>
        ) : (
          <>
            {mature && (
              <div className="main">
                <div className="tw:mt-app-m tw:rounded-app tw:bg-app-error tw:p-app-m">
                  <label className="tw:mt-0 tw:text-black">
                    <Icon icon={ICONS.INFO} className="tw:mr-app-xxs tw:mb-[-2px]" />
                    {__('Mature content')}
                  </label>
                  <p className="tw:text-app-text-error">
                    <I18nMessage
                      tokens={{
                        download_url: (
                          <Button
                            className="tw:text-app-text-error"
                            label={__('lbry.com')}
                            button="link"
                            href="https://lbry.com/get"
                          />
                        ),
                      }}
                    >
                      You can download the LBRY Desktop or Android app on %download_url% and enable mature content in
                      Settings.
                    </I18nMessage>
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </>
    )
  );
}
