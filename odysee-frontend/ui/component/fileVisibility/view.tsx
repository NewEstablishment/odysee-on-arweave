import React from 'react';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { useAppSelector } from 'redux/hooks';
import { selectIsUriUnlisted } from 'redux/selectors/claims';
type Props = {
  uri: string | null | undefined;
};

function FileVisibility(props: Props) {
  const { uri } = props;
  const isUnlisted = useAppSelector((state) => selectIsUriUnlisted(state, uri));

  if (isUnlisted) {
    return (
      <div className="tw:ml-app-s tw:max-h-[1.3rem] tw:whitespace-nowrap tw:rounded-[3px] tw:border tw:border-[var(--color-border)] tw:bg-[var(--color-visibility-label)] tw:px-app-xs tw:text-app-xsmall tw:text-[var(--color-text-subtitle)]">
        <Icon icon={ICONS.COPY_LINK} size={9} className="tw:mr-app-xxs" />
        {__('unlisted')}
      </div>
    );
  }

  return null;
}

export default FileVisibility;
