import React from 'react';
import SUPPORTED_LANGUAGES from 'constants/supported_languages';
import * as PUBLISH from 'constants/publish';
import { FormField } from 'component/common/form';
import { handleLanguageChange } from 'util/publish';
import { CollectionFormContext } from 'page/collection/internal/collectionPublishForm/context';
import Button from 'component/button';
import Card from 'component/common/card';
import { CARD_OVERFLOW_CLASS } from 'component/common/card-classes';
import { COLLECTION_ADDITIONAL_OPTIONS_ROW_CLASS } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { PUBLISH_ROW_CLASS } from 'component/publish/shared/publish-row-classes';

function CollectionPublishAdditionalOptions() {
  const { formParams, updateFormParams } = React.useContext(CollectionFormContext);
  const [hideSection, setHideSection] = React.useState(true);
  const { languages } = formParams;
  const languageParam = languages || [];
  const primaryLanguage = Array.isArray(languageParam) && languageParam.length && languageParam[0];
  const secondaryLanguage = Array.isArray(languageParam) && languageParam.length >= 2 && languageParam[1];

  function toggleHideSection() {
    setHideSection(!hideSection);
  }

  return (
    <>
      <Card
        background
        className={CARD_OVERFLOW_CLASS}
        title={__('Additional Options')}
        body={
          <>
            {!hideSection && (
              <div>
                <div className={COLLECTION_ADDITIONAL_OPTIONS_ROW_CLASS}>
                  <FormField
                    name="language_select"
                    type="select"
                    label={__('Primary Language')}
                    onChange={(event) => handleLanguageChange(0, event.target.value, languageParam, updateFormParams)}
                    value={primaryLanguage}
                  >
                    <option key={'pri-langNone'} value={PUBLISH.LANG_NONE}>
                      {__('None selected')}
                    </option>
                    {Object.keys(SUPPORTED_LANGUAGES).map((language) => (
                      <option key={language} value={language}>
                        {SUPPORTED_LANGUAGES[language]}
                      </option>
                    ))}
                  </FormField>

                  <FormField
                    name="language_select2"
                    type="select"
                    label={__('Secondary Language')}
                    onChange={(event) => handleLanguageChange(1, event.target.value, languageParam, updateFormParams)}
                    value={secondaryLanguage}
                    disabled={!languageParam[0]}
                    helper={__('Your other content language')}
                  >
                    <option key={'sec-langNone'} value={PUBLISH.LANG_NONE}>
                      {__('None selected')}
                    </option>
                    {Object.keys(SUPPORTED_LANGUAGES)
                      .filter((lang) => lang !== languageParam[0])
                      .map((language) => (
                        <option key={language} value={language}>
                          {SUPPORTED_LANGUAGES[language]}
                        </option>
                      ))}
                  </FormField>
                </div>
              </div>
            )}

            <div className={PUBLISH_ROW_CLASS}>
              <div className={SECTION_CLASSES.actions}>
                <Button label={hideSection ? __('Show') : __('Hide')} button="link" onClick={toggleHideSection} />
              </div>
            </div>
          </>
        }
      />
    </>
  );
}

export default CollectionPublishAdditionalOptions;
