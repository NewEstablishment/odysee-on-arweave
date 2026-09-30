import * as ICONS from 'constants/icons';
import React from 'react';
import Page from 'component/page';
import Icon from 'component/common/icon';
type Props = {};

function TagsFollowingPage(props: Props) {
  return (
    <Page noFooter fullWidthPage>
      {Object.keys(ICONS)
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => (
          <>
            <div className="tw:mb-[15px]">
              <Icon icon={ICONS[tag]} size={10} className="tw:mb-[-3px] tw:inline-block tw:size-[20px]" />
              <h2 className="tw:ml-[7px] tw:inline">{tag}</h2>
              <br />
            </div>
          </>
        ))}
    </Page>
  );
}

export default TagsFollowingPage;
